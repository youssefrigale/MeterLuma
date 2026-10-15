mod codex;
mod auth;
mod map;
mod cooldowns;
mod snapshots;
mod renewal;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use std::{collections::HashMap, time::{Duration, Instant}};

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId { Claude, Codex, Cursor }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metric {
    pub label: String,
    pub used_percent: f64,
    pub reset_at: Option<i64>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: ProviderId,
    pub name: String,
    pub plan: String,
    pub color: String,
    pub initials: String,
    pub spend_today: Option<f64>,
    pub metrics: Vec<Metric>,
    pub fetched_at: i64,
}

struct Cache { fingerprint: [u8; 32], until: Instant, result: Result<Snapshot, String> }

pub struct ProviderService {
    client: reqwest::Client,
    caches: [Mutex<HashMap<String, Cache>>; 2],
    codex_lock: Mutex<()>,
    cooldowns: std::sync::Mutex<cooldowns::Cooldowns>,
    snapshots: std::sync::Mutex<snapshots::Snapshots>,
}
impl ProviderService {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: reqwest::Client::builder().timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none()).user_agent("MeterLuma/0.1.0").build()?,
            caches: std::array::from_fn(|_| Mutex::new(HashMap::new())), codex_lock: Mutex::new(()),
            cooldowns: std::sync::Mutex::new(cooldowns::Cooldowns::load(dirs::cache_dir().map(|path| path.join("MeterLuma/usage-cooldowns-v1.json")))),
            snapshots: std::sync::Mutex::new(snapshots::Snapshots::load(dirs::cache_dir().map(|path| path.join("MeterLuma/quota-snapshots-v1.json")))),
        })
    }
    pub async fn refresh(&self, id: ProviderId, directory: Option<String>) -> Result<Snapshot, String> {
        if matches!(id, ProviderId::Codex) {
            let root = crate::profiles::root(id, directory.as_deref())?;
            let _guard = self.codex_lock.lock().await;
            let value = tauri::async_runtime::spawn_blocking(move || codex::limits(&root)).await
                .map_err(|_| "The Codex quota lookup could not complete.".to_string())??;
            return map::map(id, &codex::normalized(&value));
        }
        let index = if matches!(id, ProviderId::Claude) { 0 } else { 1 };
        let root = crate::profiles::root(id, directory.as_deref())?;
        let key = root.to_string_lossy().into_owned();
        let mut caches = self.caches[index].lock().await;
        let cooldown_key = cooldowns::key(id, &root);
        if let Some(until) = self.cooldowns.lock().ok().and_then(|store| store.until(&cooldown_key)) {
            let seconds = (until.saturating_sub(chrono::Utc::now().timestamp_millis()).max(0) + 999) / 1000;
            return Err(format!("The provider is limiting requests. MeterLuma will retry after {seconds} seconds."));
        }
        let source = directory.clone();
        let mut credential = tauri::async_runtime::spawn_blocking(move || auth::load(id, source.as_deref())).await
            .map_err(|_| "Your local sign-in could not be read.".to_string())??;
        let initial_fingerprint = credential.fingerprint();
        if let Some(previous) = caches.get(&key) {
            if previous.fingerprint == initial_fingerprint && previous.until > Instant::now() { return previous.result.clone(); }
        }
        let mut renewed = false;
        if matches!(id, ProviderId::Claude) {
            match self.renew_login(&credential, directory.as_deref(), &cooldown_key, false).await {
                Ok(Some(current)) => { credential = current; renewed = true; },
                Ok(None) => {},
                Err(error) => { caches.insert(key, Cache { fingerprint: initial_fingerprint, until: Instant::now() + Duration::from_secs(30), result: Err(error.clone()) }); return Err(error); }
            }
        }
        let mut fingerprint = credential.fingerprint();
        if let Some(previous) = caches.get(&key) {
            if previous.fingerprint == fingerprint && previous.until > Instant::now() { return previous.result.clone(); }
        }
        let request = self.usage_request(id, &credential.token)?;
        let (mut result, mut retry_in) = response_result(request, id).await;
        if matches!(id, ProviderId::Claude) && !renewed && result.as_ref().err().is_some_and(|error| error.starts_with("Your sign-in has expired.")) {
            match self.renew_login(&credential, directory.as_deref(), &cooldown_key, true).await {
                Ok(Some(current)) => {
                    credential = current; fingerprint = credential.fingerprint();
                    (result, retry_in) = response_result(self.usage_request(id, &credential.token)?, id).await;
                },
                Ok(None) => {},
                Err(error) => { caches.insert(key, Cache { fingerprint, until: Instant::now() + Duration::from_secs(30), result: Err(error.clone()) }); return Err(error); }
            }
        }
        if result.as_ref().err().is_some_and(|error| error.starts_with("The provider is limiting requests.")) {
            if let Ok(mut store) = self.cooldowns.lock() { store.set(cooldown_key, retry_in); }
        }
        let current = tauri::async_runtime::spawn_blocking(move || auth::load(id, directory.as_deref())).await
            .map_err(|_| "Your current sign-in could not be checked.".to_string())??;
        if current.fingerprint() != fingerprint {
            caches.remove(&key);
            return Err("Your provider sign-in changed. Refresh again to read the current account.".into());
        }
        if let Ok(snapshot) = &result {
            if let Ok(mut store) = self.snapshots.lock() { store.put(cooldowns::key(id, &root), fingerprint, snapshot.clone()); }
        }
        caches.retain(|_, row| row.until > Instant::now());
        if caches.len() >= 16 { caches.clear(); }
        caches.insert(key, Cache { fingerprint, until: Instant::now() + Duration::from_secs(retry_in.min(300)), result: result.clone() });
        result
    }

    async fn renew_login(&self, credential: &auth::Credential, directory: Option<&str>, key: &str, force: bool) -> Result<Option<auth::Credential>, String> {
        match renewal::renew(&self.client, credential, directory, force).await {
            Ok(Some(current)) => {
                if let Ok(mut store) = self.snapshots.lock() {
                    if let Some(snapshot) = store.get(key, credential.fingerprint(), ProviderId::Claude, chrono::Utc::now().timestamp_millis()) {
                        // A guarded rotation belongs to the same refresh grant. Keep its
                        // verified snapshot bound to the newly saved access credential.
                        store.put(key.to_string(), current.fingerprint(), snapshot);
                    }
                }
                Ok(Some(current))
            },
            Ok(None) => Ok(None),
            Err(error) => {
                if let Some(seconds) = error.retry_after { if let Ok(mut store) = self.cooldowns.lock() { store.set(key.to_string(), seconds); } }
                Err(error.message)
            }
        }
    }

    async fn last_snapshot(&self, id: ProviderId, directory: Option<String>) -> Option<Snapshot> {
        if matches!(id, ProviderId::Codex) { return None; }
        let root = crate::profiles::root(id, directory.as_deref()).ok()?;
        let credential = tauri::async_runtime::spawn_blocking(move || auth::load(id, directory.as_deref())).await.ok()?.ok()?;
        self.snapshots.lock().ok()?.get(&cooldowns::key(id, &root), credential.fingerprint(), id, chrono::Utc::now().timestamp_millis())
    }

    fn usage_request(&self, id: ProviderId, token: &str) -> Result<reqwest::RequestBuilder, String> {
        let request = match id {
            ProviderId::Claude => self.client.get("https://api.anthropic.com/api/oauth/usage")
                .header("anthropic-beta", "oauth-2025-04-20").header("Content-Type", "application/json")
                .header("User-Agent", "claude-cli/2.1.294 (external, cli) MeterLuma/0.1.0"),
            ProviderId::Cursor => self.client.post("https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage")
                .header("Connect-Protocol-Version", "1").json(&serde_json::json!({})),
            ProviderId::Codex => return Err("Codex quotas use the official CLI app-server.".into()),
        };
        Ok(request.bearer_auth(token).header("Accept", "application/json"))
    }
}

async fn response_result(request: reqwest::RequestBuilder, id: ProviderId) -> (Result<Snapshot, String>, u64) {
    match request.send().await {
            Err(_) => (Err("The provider could not be reached. Check your connection and try again.".into()), 30),
            Ok(mut response) => {
                let status = response.status();
                if status.as_u16() == 429 {
                    let retry = cooldowns::retry_seconds(response.headers().get("retry-after").and_then(|value| value.to_str().ok()), chrono::Utc::now().timestamp_millis());
                    (Err(format!("The provider is limiting requests. MeterLuma will retry after {retry} seconds.")), retry)
                } else if status.as_u16() == 401 {
                    (Err("Your sign-in has expired. Sign in again using the provider app.".into()), 30)
                } else if status.as_u16() == 403 {
                    (Err("Your sign-in cannot read usage limits. Sign in again using the provider app.".into()), 30)
                } else if !status.is_success() {
                    (Err(format!("The provider returned HTTP {}. Please try again later.", status.as_u16())), 30)
                } else {
                    let mut bytes = Vec::new();
                    let mut read_error = None;
                    loop {
                        match response.chunk().await {
                            Ok(Some(chunk)) if bytes.len() + chunk.len() <= 1_048_576 => bytes.extend_from_slice(&chunk),
                            Ok(Some(_)) => { read_error = Some("The provider response is unexpectedly large.".to_string()); break; }
                            Ok(None) => break,
                            Err(_) => { read_error = Some("The provider response could not be read.".to_string()); break; }
                        }
                    }
                    let result = if let Some(error) = read_error { Err(error) } else {
                        serde_json::from_slice(&bytes).map_err(|_| "The provider response format is not supported.".to_string())
                            .and_then(|value| map::map(id, &value))
                    };
                    let lifetime = if result.is_ok() { 300 } else { 30 };
                    (result, lifetime)
                }
            }
        }
}

#[tauri::command]
pub async fn refresh_provider(service: tauri::State<'_, ProviderService>, provider_id: ProviderId, config_directory: Option<String>) -> Result<Snapshot, ProviderFailure> {
    let root = crate::profiles::root(provider_id, config_directory.as_deref()).ok();
    match service.refresh(provider_id, config_directory.clone()).await { Ok(snapshot) => Ok(snapshot), Err(message) => {
        let retry_at = root.and_then(|root| service.cooldowns.lock().ok().and_then(|store| store.until(&cooldowns::key(provider_id, &root))));
        let code = if retry_at.is_some() { "rate_limited" } else if message.contains("sign-in") || message.contains("Sign in") || message.contains("subscription") { "sign_in_required" } else { "unavailable" };
        let last_snapshot = service.last_snapshot(provider_id, config_directory).await;
        Err(ProviderFailure { code, message, retry_at, last_snapshot })
    } }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFailure { code: &'static str, message: String, retry_at: Option<i64>, last_snapshot: Option<Snapshot> }

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    fn response(status: &str, extra: &str, body: String) -> (Result<Snapshot, String>, u64) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let header = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = Vec::new();
            let mut byte = [0; 1];
            while !request.ends_with(b"\r\n\r\n") { if socket.read(&mut byte).unwrap_or(0) == 0 { break; } request.push(byte[0]); }
            let _ = socket.write_all(header.as_bytes()); let _ = socket.write_all(body.as_bytes());
        });
        let result = tauri::async_runtime::block_on(response_result(ProviderService::new().unwrap().client.get(format!("http://{address}")), ProviderId::Claude));
        server.join().unwrap();
        result
    }

    #[test]
    fn cooldown_blocks_manual_refresh_before_credentials_or_transport_are_used() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut service = ProviderService::new().unwrap();
        service.client = reqwest::Client::builder().proxy(reqwest::Proxy::all(format!("http://{}", listener.local_addr().unwrap())).unwrap()).timeout(Duration::from_secs(1)).build().unwrap();
        let root = crate::profiles::root(ProviderId::Claude, None).unwrap();
        service.cooldowns = std::sync::Mutex::new(cooldowns::Cooldowns::default());
        service.cooldowns.lock().unwrap().set(cooldowns::key(ProviderId::Claude, &root), 3600);
        for _ in 0..2 {
            let error = tauri::async_runtime::block_on(service.refresh(ProviderId::Claude, None)).err().unwrap();
            assert!(error.starts_with("The provider is limiting requests."));
        }
        assert_eq!(listener.accept().err().unwrap().kind(), std::io::ErrorKind::WouldBlock);
    }

    #[test]
    fn restored_requests_are_fixed_https_usage_only_and_never_follow_redirects() {
        let service = ProviderService::new().unwrap();
        for (id, host, path) in [(ProviderId::Claude, "api.anthropic.com", "/api/oauth/usage"), (ProviderId::Cursor, "api2.cursor.sh", "/aiserver.v1.DashboardService/GetCurrentPeriodUsage")] {
            let request = service.usage_request(id, "test-token").unwrap().build().unwrap();
            assert_eq!(request.url().scheme(), "https"); assert_eq!(request.url().host_str(), Some(host)); assert_eq!(request.url().path(), path);
            assert_eq!(request.headers()["authorization"], "Bearer test-token");
        }
        assert!(service.usage_request(ProviderId::Codex, "unused").is_err());
        let (result, _) = response("302 Found", "Location: http://127.0.0.1:9/never-follow\r\n", String::new());
        assert!(result.err().unwrap().contains("HTTP 302"));
    }

    #[test]
    fn http_errors_do_not_expose_response_secrets_and_throttling_is_bounded() {
        let (result, _) = response("401 Unauthorized", "", "private-token private-account".into());
        let error = result.err().unwrap(); assert!(error.contains("Sign in again")); assert!(!error.contains("private-"));
        let (result, retry) = response("429 Too Many Requests", "Retry-After: 7\r\n", "private-token".into());
        assert_eq!(retry, 30); assert!(result.is_err());
    }

    #[test]
    fn live_transport_preserves_missing_resets_and_rejects_oversized_payloads() {
        let (result, retry) = response("200 OK", "", r#"{"five_hour":{"utilization":42,"resets_at":null}}"#.into());
        let snapshot = result.unwrap(); assert_eq!(snapshot.metrics[0].used_percent, 42.0); assert_eq!(snapshot.metrics[0].reset_at, None); assert_eq!(retry, 300);
        let (result, _) = response("200 OK", "", "x".repeat(1_048_577)); assert!(result.err().unwrap().contains("large"));
    }

    #[test]
    #[ignore = "Requires a signed-in local provider; opt in with METERLUMA_LIVE_PROVIDER."]
    fn live_provider_smoke() {
        let id = match std::env::var("METERLUMA_LIVE_PROVIDER").as_deref() { Ok("claude") => ProviderId::Claude, Ok("cursor") => ProviderId::Cursor, _ => panic!("Set METERLUMA_LIVE_PROVIDER to claude or cursor.") };
        let service = ProviderService::new().unwrap();
        let result = tauri::async_runtime::block_on(service.refresh(id, None));
        match result { Ok(snapshot) => assert!(!snapshot.metrics.is_empty()), Err(error) => panic!("Live connection unavailable: {error}") }
    }
}
