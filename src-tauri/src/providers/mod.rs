mod codex;
mod claude;
mod auth;
mod cursor_storage;
mod map;
mod cooldowns;
mod snapshots;
mod tokens;
pub mod manual;
pub(crate) mod additional;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use std::{collections::HashMap, path::{Path, PathBuf}, sync::Arc, time::{Duration, Instant}};

pub const CLAUDE_UNAVAILABLE: &str = "Enable live Claude usage in Connections to read live limits. Local history remains available.";

#[cfg(any(target_os = "windows", test))]
pub(crate) fn has_cursor_sign_in(root: &Path) -> bool { auth::cursor(root, false).is_ok() }
const USER_AGENT: &str = concat!("MeterLuma/", env!("CARGO_PKG_VERSION"));
const CURSOR_USAGE: &str = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
// Both always-alive windows poll at least every 5 minutes; a just-under-5-minute window keeps them on one CLI run.
const CODEX_FRESH: Duration = Duration::from_secs(290);
// Equals Tauri's app_cache_dir, which the uninstaller's delete-app-data option removes.
pub(crate) const CACHE_FOLDER: &str = "app.meterluma.desktop";
// On Windows the legacy folder is also the per-user install directory: remove only these two files.
const LEGACY_CACHES: [&str; 2] = ["MeterLuma/quota-snapshots-v1.json", "MeterLuma/usage-cooldowns-v1.json"];

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId { Claude, Codex, Cursor }

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metric {
    pub label: String,
    pub used_percent: f64,
    pub reset_at: Option<i64>,
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub period_minutes: Option<u64>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCredits {
    pub has_credits: Option<bool>,
    pub unlimited: Option<bool>,
    pub balance: Option<f64>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccount {
    pub credits: Option<CodexCredits>,
    pub available_resets: Option<u64>,
    pub included_usage_allowed: Option<bool>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeExtraUsage {
    pub spent: Option<f64>,
    pub monthly_limit: Option<f64>,
    pub currency: Option<String>,
    pub decimal_places: Option<u32>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub codex_account: Option<CodexAccount>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_extra_usage: Option<ClaudeExtraUsage>,
}

struct Cache { fingerprint: [u8; 32], checked_at: Instant, until: Instant, result: Result<Snapshot, String> }
struct Lookup { done: Instant, fingerprint: Option<[u8; 32]>, result: Result<Snapshot, String> }

fn before_reset(snapshot: &Snapshot) -> bool { snapshot.metrics.iter().all(|metric| metric.reset_at.is_none_or(|reset| reset > chrono::Utc::now().timestamp_millis())) }

pub struct ProviderService {
    client: reqwest::Client,
    manual: Mutex<HashMap<String, Cache>>,
    local: Mutex<HashMap<String, Cache>>,
    connection_gates: std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>,
    claude_credential: fn(&Path, bool) -> Result<claude::SignIn, String>,
    codex: std::sync::Mutex<HashMap<String, Arc<Mutex<Option<Lookup>>>>>,
    codex_runner: fn(&Path) -> Result<serde_json::Value, String>,
    codex_token_runner: fn(&tokens::AccountToken) -> Result<serde_json::Value, String>,
    manual_credential: fn(ProviderId) -> Result<tokens::AccountToken, String>,
    cursor_credential: fn(&Path, bool) -> Result<auth::Credential, String>,
    cooldowns: std::sync::Mutex<cooldowns::Cooldowns>,
    snapshots: std::sync::Mutex<snapshots::Snapshots>,
}

// OS trust roots let antivirus HTTPS scanning and inspected networks verify; bundled roots cover an empty or unreadable OS store.
fn client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder().timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).user_agent(USER_AGENT)
}

fn remove_legacy(cache: &Path) { for name in LEGACY_CACHES { let _ = std::fs::remove_file(cache.join(name)); } }

fn persist(path: &Option<PathBuf>, value: &impl Serialize) {
    let Some(path) = path else { return; };
    if !path.parent().is_some_and(|parent| std::fs::create_dir_all(parent).is_ok()) { return; }
    if let Ok(bytes) = serde_json::to_vec(value) {
        let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
        if std::fs::write(&temporary, bytes).is_ok() && std::fs::rename(&temporary, path).is_err() { let _ = std::fs::remove_file(&temporary); }
    }
}

impl ProviderService {
    pub fn new() -> Result<Self, reqwest::Error> {
        let cache = dirs::cache_dir();
        if let Some(cache) = &cache { remove_legacy(cache); }
        Self::with_cache(cache.map(|cache| cache.join(CACHE_FOLDER)))
    }
    fn with_cache(folder: Option<PathBuf>) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: client_builder().build().or_else(|_| client_builder().tls_built_in_native_certs(false).build())?,
            manual: Mutex::new(HashMap::new()),
            local: Mutex::new(HashMap::new()), connection_gates: Default::default(), claude_credential: claude::sign_in, codex: Default::default(), codex_runner: codex::limits, codex_token_runner: codex::limits_with_token, manual_credential: tokens::load, cursor_credential: auth::cursor,
            cooldowns: std::sync::Mutex::new(cooldowns::Cooldowns::load(folder.as_ref().map(|path| path.join("usage-cooldowns-v2.json")))),
            snapshots: std::sync::Mutex::new(snapshots::Snapshots::load(folder.map(|path| path.join("quota-snapshots-v1.json")))),
        })
    }
    // A manual refresh passes `fresh_after`, so a short-lived success cache never hides a change made on the provider's site.
    pub async fn refresh(&self, id: ProviderId, directory: Option<String>, fresh_after: Option<Instant>) -> Result<Snapshot, ProviderFailure> {
        // Legacy/history-only calls never access Claude credentials or the network.
        if matches!(id, ProviderId::Claude) { return Err(ProviderFailure::new(CLAUDE_UNAVAILABLE.into(), None, None)); }
        let root = crate::profiles::root(id, directory.as_deref()).map_err(|message| ProviderFailure::new(message, None, None))?;
        if matches!(id, ProviderId::Codex) { return self.codex(root, fresh_after).await.map_err(|message| ProviderFailure::new(message, None, None)); }
        self.cursor(root, directory.is_none(), fresh_after).await
    }

    pub async fn refresh_claude(&self, directory: Option<String>, fresh_after: Option<Instant>) -> Result<Snapshot, ProviderFailure> {
        let root = crate::profiles::root(ProviderId::Claude, directory.as_deref()).map_err(|message| ProviderFailure::new(message, None, None))?;
        self.local_usage(ProviderId::Claude, root, directory.is_none(), fresh_after).await
    }

    // One CLI process per profile at a time: concurrent requests share the in-flight lookup, and a success stays fresh
    // briefly for polling. A manual refresh reuses only a lookup that finished after it was asked for.
    async fn codex(&self, root: PathBuf, fresh_after: Option<Instant>) -> Result<Snapshot, String> {
        let asked = Instant::now();
        let fingerprint = codex::auth_fingerprint(&root);
        let key = cooldowns::key(ProviderId::Codex, &root);
        let slot = {
            let mut slots = self.codex.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            if slots.len() >= 16 && !slots.contains_key(&key) { slots.retain(|_, slot| Arc::strong_count(slot) > 1); }
            slots.entry(key).or_default().clone()
        };
        let mut last = slot.lock().await;
        if let Some(lookup) = last.as_ref().filter(|lookup| lookup.fingerprint == fingerprint && (lookup.done >= asked || (fresh_after.is_none() && fingerprint.is_some() && lookup.result.as_ref().is_ok_and(before_reset) && lookup.done.elapsed() < CODEX_FRESH))) { return lookup.result.clone(); }
        let run = self.codex_runner;
        let lookup_root = root.clone();
        let mut result = tauri::async_runtime::spawn_blocking(move || run(&lookup_root)).await.map_err(|_| "The Codex quota lookup could not complete.".to_string())
            .and_then(|value| value).and_then(|value| map::map(ProviderId::Codex, &codex::normalized(&value)));
        if codex::auth_fingerprint(&root) != fingerprint { result = Err("Your Codex sign-in changed. Refresh again to read the current account.".into()); }
        *last = Some(Lookup { done: Instant::now(), fingerprint, result: result.clone() });
        result
    }

    async fn cursor(&self, root: PathBuf, default_profile: bool, fresh_after: Option<Instant>) -> Result<Snapshot, ProviderFailure> {
        self.local_usage(ProviderId::Cursor, root, default_profile, fresh_after).await
    }

    fn connection_gate(&self, key: &str) -> Arc<Mutex<()>> {
        let mut gates = self.connection_gates.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        gates.retain(|_, gate| Arc::strong_count(gate) > 1);
        gates.entry(key.into()).or_default().clone()
    }

    async fn local_usage(&self, id: ProviderId, root: PathBuf, default_profile: bool, fresh_after: Option<Instant>) -> Result<Snapshot, ProviderFailure> {
        let key = cooldowns::key(id, &root);
        let gate = self.connection_gate(&key);
        let _turn = gate.lock().await;
        let (credential, plan) = self.local_sign_in(id, &root, default_profile).await.map_err(|message| ProviderFailure::new(message, None, None))?;
        let fingerprint = credential.fingerprint();
        // Cooldowns belong to the signed-in account, so signing in again is never blocked by the previous account's limit.
        if let Some(until) = self.cooldowns.lock().ok().and_then(|store| store.until(&key, &fingerprint)) {
            let seconds = (until.saturating_sub(chrono::Utc::now().timestamp_millis()).max(0) + 999) / 1000;
            return Err(self.quota_failure(format!("The provider is limiting requests. MeterLuma will retry after {seconds} seconds."), &key, fingerprint, id));
        }
        if let Some(previous) = self.local.lock().await.get(&key).filter(|row| row.fingerprint == fingerprint && row.until > Instant::now() && fresh_after.is_none_or(|asked| row.checked_at >= asked) && row.result.as_ref().map(before_reset).unwrap_or(true)) {
            return previous.result.clone().map(|mut snapshot| { if let Some(plan) = plan { snapshot.plan = plan; } snapshot }).map_err(|message| self.quota_failure(message, &key, fingerprint, id));
        }
        let request = self.local_usage_request(id, &credential.token);
        let (mut result, retry_in) = response_result(request, id).await;
        if let (Ok(snapshot), Some(plan)) = (&mut result, plan) { snapshot.plan = plan; }
        if result.as_ref().err().is_some_and(|error| error.starts_with("The provider is limiting requests.")) {
            if let Ok(mut store) = self.cooldowns.lock() { store.set(key.clone(), &fingerprint, retry_in); }
        }
        let current = self.local_sign_in(id, &root, default_profile).await.map_err(|message| ProviderFailure::new(message, None, None))?.0.fingerprint();
        if current != fingerprint {
            self.local.lock().await.remove(&key);
            return Err(self.quota_failure("Your provider sign-in changed. Refresh again to read the current account.".into(), &key, current, id));
        }
        if let Ok(snapshot) = &result {
            if let Ok(mut store) = self.snapshots.lock() { store.put(key.clone(), fingerprint, snapshot.clone()); }
        }
        let mut caches = self.local.lock().await;
        caches.retain(|_, row| row.until > Instant::now());
        if caches.len() >= 16 { caches.clear(); }
        let lifetime = result.as_ref().ok().filter(|_| matches!(id, ProviderId::Claude)).map(claude_cache_seconds).unwrap_or(retry_in.min(300));
        caches.insert(key.clone(), Cache { fingerprint, checked_at: Instant::now(), until: Instant::now() + Duration::from_secs(lifetime), result: result.clone() });
        result.map_err(|message| self.quota_failure(message, &key, fingerprint, id))
    }

    async fn local_sign_in(&self, id: ProviderId, root: &Path, default_profile: bool) -> Result<(auth::Credential, Option<String>), String> {
        let (cursor, claude, root) = (self.cursor_credential, self.claude_credential, root.to_path_buf());
        tauri::async_runtime::spawn_blocking(move || match id {
            ProviderId::Claude => claude(&root, default_profile).map(|login| (login.credential, Some(login.plan))),
            _ => cursor(&root, default_profile).map(|credential| (credential, None)),
        }).await.map_err(|_| "Your local sign-in could not be read.".to_string())?
    }

    fn quota_failure(&self, message: String, key: &str, fingerprint: [u8; 32], id: ProviderId) -> ProviderFailure {
        let retry_at = self.cooldowns.lock().ok().and_then(|store| store.until(key, &fingerprint));
        let last_snapshot = self.snapshots.lock().ok().and_then(|store| store.get(key, fingerprint, id, chrono::Utc::now().timestamp_millis()));
        ProviderFailure::new(message, retry_at, last_snapshot)
    }

    fn usage_request(&self, token: &str) -> reqwest::RequestBuilder {
        self.client.post(CURSOR_USAGE).header("Connect-Protocol-Version", "1").json(&serde_json::json!({}))
            .bearer_auth(token).header("Accept", "application/json")
    }

    fn local_usage_request(&self, id: ProviderId, token: &str) -> reqwest::RequestBuilder {
        match id {
            ProviderId::Claude => self.client.get("https://api.anthropic.com/api/oauth/usage").bearer_auth(token).header("anthropic-beta", "oauth-2025-04-20").header("Accept", "application/json"),
            _ => self.usage_request(token),
        }
    }
}

fn claude_cache_seconds(snapshot: &Snapshot) -> u64 {
    // Expire just before the renderer's 30/60-second poll, including across windows.
    if snapshot.metrics.iter().any(|metric| metric.label == "Session" && (75.0..100.0).contains(&metric.used_percent)) { 29 } else { 59 }
}

fn transport_error(error: &reqwest::Error) -> String {
    let mut source = std::error::Error::source(error);
    let mut tls = false;
    while let Some(cause) = source {
        let (io, text) = (cause.downcast_ref::<std::io::Error>(), cause.to_string().to_lowercase());
        tls |= io.is_some_and(|io| io.kind() == std::io::ErrorKind::InvalidData) || ["certificate", "tls", "handshake"].iter().any(|word| text.contains(word));
        // io::Error hides the error it wraps from source(); rustls failures arrive wrapped as InvalidData.
        source = match io.and_then(std::io::Error::get_ref) { Some(inner) => Some(inner), None => cause.source() };
    }
    if tls { "A secure connection to the provider could not be verified. If antivirus HTTPS scanning, a network filter or a proxy inspects traffic, make sure its certificate is trusted by your operating system, then try again.".into() }
    else if error.is_timeout() { "The provider did not respond in time. Check your connection and try again.".into() }
    else if error.is_connect() { "MeterLuma could not connect to the provider. Check your internet connection, VPN or proxy settings, then try again.".into() }
    else { "The provider could not be reached. Check your connection and try again.".into() }
}

async fn response_result(request: reqwest::RequestBuilder, id: ProviderId) -> (Result<Snapshot, String>, u64) {
    match request.send().await {
            Err(error) => (Err(transport_error(&error)), 30),
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
pub async fn refresh_provider(service: tauri::State<'_, ProviderService>, provider_id: ProviderId, config_directory: Option<String>, token_mode: Option<bool>, claude_live: Option<bool>, force_refresh: Option<bool>) -> Result<Snapshot, ProviderFailure> {
    let fresh_after = force_refresh.filter(|force| *force).map(|_| Instant::now());
    if token_mode == Some(true) { return service.refresh_token(provider_id, fresh_after).await; }
    if matches!(provider_id, ProviderId::Claude) && claude_live == Some(true) { return service.refresh_claude(config_directory, fresh_after).await; }
    service.refresh(provider_id, config_directory, fresh_after).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderFailure { code: &'static str, message: String, retry_at: Option<i64>, last_snapshot: Option<Box<Snapshot>> }
impl ProviderFailure {
    fn new(message: String, retry_at: Option<i64>, last_snapshot: Option<Snapshot>) -> Self {
        let code = if retry_at.is_some() { "rate_limited" } else if message.contains("sign-in") || message.contains("Sign in") || message.contains("subscription") { "sign_in_required" } else { "unavailable" };
        Self { code, message, retry_at, last_snapshot: last_snapshot.map(Box::new) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::{Read, Write}, net::TcpListener, sync::atomic::{AtomicUsize, Ordering}};

    fn response(status: &str, extra: &str, body: String) -> (Result<Snapshot, String>, u64, String) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let header = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n", body.len());
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            socket.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut request = Vec::new();
            let mut byte = [0; 1];
            while !request.ends_with(b"\r\n\r\n") { if socket.read(&mut byte).unwrap_or(0) == 0 { break; } request.push(byte[0]); }
            let _ = socket.write_all(header.as_bytes()); let _ = socket.write_all(body.as_bytes());
            String::from_utf8_lossy(&request).to_lowercase()
        });
        let client = client_builder().no_proxy().build().unwrap();
        let (result, retry) = tauri::async_runtime::block_on(response_result(client.get(format!("http://{address}")), ProviderId::Cursor));
        (result, retry, server.join().unwrap())
    }

    fn fake_sign_in(_: &Path, _: bool) -> Result<auth::Credential, String> { Ok(auth::Credential { token: "fake-cursor-token".into() }) }
    static ACTIVE_READS: AtomicUsize = AtomicUsize::new(0);
    static PEAK_READS: AtomicUsize = AtomicUsize::new(0);
    fn slow_sign_in(_: &Path, _: bool) -> Result<auth::Credential, String> {
        let active = ACTIVE_READS.fetch_add(1, Ordering::SeqCst) + 1;
        PEAK_READS.fetch_max(active, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(100));
        ACTIVE_READS.fetch_sub(1, Ordering::SeqCst);
        Ok(auth::Credential { token: "synthetic-independent-profile-token".into() })
    }

    #[test]
    fn slow_local_profiles_do_not_serialize_unrelated_accounts() {
        let proxy = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); let address = proxy.local_addr().unwrap(); drop(proxy);
        let mut service = ProviderService::with_cache(None).unwrap(); service.cursor_credential = slow_sign_in;
        service.client = client_builder().proxy(reqwest::Proxy::all(format!("http://{address}")).unwrap()).build().unwrap();
        let service = Arc::new(service);
        let tasks: Vec<_> = ["synthetic-profile-a", "synthetic-profile-b"].map(|profile| {
            let service = service.clone();
            tauri::async_runtime::spawn(async move { service.local_usage(ProviderId::Cursor, PathBuf::from(profile), false, None).await })
        }).into_iter().collect();
        for task in tasks { assert!(tauri::async_runtime::block_on(task).unwrap().is_err()); }
        assert!(PEAK_READS.load(Ordering::SeqCst) >= 2);
    }
    static MANUAL_READS: AtomicUsize = AtomicUsize::new(0);
    static TOKEN_RUNS: AtomicUsize = AtomicUsize::new(0);
    static MANUAL_PEAK: AtomicUsize = AtomicUsize::new(0);
    fn slow_manual_token(_: ProviderId) -> Result<tokens::AccountToken,String> {
        let active=MANUAL_READS.fetch_add(1,Ordering::SeqCst)+1; MANUAL_PEAK.fetch_max(active,Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(100)); MANUAL_READS.fetch_sub(1,Ordering::SeqCst);
        Ok(tokens::AccountToken{access_token:"synthetic-only-token".into(),account_id:None})
    }
    #[test]
    fn manually_supplied_accounts_refresh_independently_without_reading_real_secure_storage() {
        let port=TcpListener::bind("127.0.0.1:0").unwrap();let address=port.local_addr().unwrap();drop(port);
        let mut service=ProviderService::with_cache(None).unwrap();service.manual_credential=slow_manual_token;
        service.codex_token_runner=|_|{TOKEN_RUNS.fetch_add(1,Ordering::SeqCst);Ok(serde_json::json!({"rateLimits":{"primary":{"usedPercent":25,"windowDurationMins":300}}}))};
        service.client=client_builder().proxy(reqwest::Proxy::all(format!("http://{address}")).unwrap()).build().unwrap();
        let service=Arc::new(service);
        let jobs:Vec<_>=[ProviderId::Codex,ProviderId::Cursor].map(|id|{let service=service.clone();tauri::async_runtime::spawn(async move{service.refresh_token(id,None).await})}).into_iter().collect();
        let mut outcomes=jobs.into_iter().map(|job|tauri::async_runtime::block_on(job).unwrap());
        assert!(outcomes.next().unwrap().is_ok()); assert!(outcomes.next().unwrap().is_err());
        assert!(MANUAL_PEAK.load(Ordering::SeqCst)>=2);
        assert!(tauri::async_runtime::block_on(service.refresh_token(ProviderId::Codex,None)).is_ok());
        assert_eq!(TOKEN_RUNS.load(Ordering::SeqCst),1,"a poll reuses the brief success cache");
        assert!(tauri::async_runtime::block_on(service.refresh_token(ProviderId::Codex,Some(Instant::now()))).is_ok());
        assert_eq!(TOKEN_RUNS.load(Ordering::SeqCst),2,"a manual refresh reads the account again");
    }
    fn offline(proxy: &TcpListener) -> ProviderService {
        let mut service = ProviderService::with_cache(None).unwrap();
        service.client = client_builder().proxy(reqwest::Proxy::all(format!("http://{}", proxy.local_addr().unwrap())).unwrap()).timeout(Duration::from_secs(1)).build().unwrap();
        service.cursor_credential = fake_sign_in;
        service.codex_runner = |_| panic!("The Codex CLI must not start in this test.");
        service
    }
    fn listener() -> TcpListener { let listener = TcpListener::bind("127.0.0.1:0").unwrap(); listener.set_nonblocking(true).unwrap(); listener }

    #[test]
    fn claude_refresh_is_unavailable_before_any_profile_credential_process_or_network_access() {
        let proxy = listener();
        let mut service = offline(&proxy);
        service.cursor_credential = |_, _| panic!("Claude refresh must not read any sign-in.");
        for directory in [None, Some("relative/profile".to_string()), Some(std::env::temp_dir().join("meterluma-missing-claude-profile").to_string_lossy().into_owned())] {
            let failure = tauri::async_runtime::block_on(service.refresh(ProviderId::Claude, directory, None)).err().unwrap();
            assert_eq!(failure.message, CLAUDE_UNAVAILABLE);
            assert_eq!(failure.code, "unavailable");
            assert!(failure.retry_at.is_none() && failure.last_snapshot.is_none());
        }
        assert_eq!(proxy.accept().err().unwrap().kind(), std::io::ErrorKind::WouldBlock);
    }

    #[test]
    fn cursor_cooldown_blocks_manual_refresh_without_network_but_not_a_new_sign_in() {
        let proxy = listener();
        let mut service = offline(&proxy);
        let root = std::env::temp_dir().join("meterluma-cursor-profile-fixture");
        let key = cooldowns::key(ProviderId::Cursor, &root);
        service.cooldowns.lock().unwrap().set(key, &fake_sign_in(&root, false).unwrap().fingerprint(), 3600);
        for _ in 0..2 {
            let failure = tauri::async_runtime::block_on(service.cursor(root.clone(), false, None)).err().unwrap();
            assert!(failure.message.starts_with("The provider is limiting requests."));
            assert_eq!(failure.code, "rate_limited");
            assert!(failure.retry_at.is_some_and(|until| until <= chrono::Utc::now().timestamp_millis() + 3_600_000));
        }
        assert_eq!(proxy.accept().err().unwrap().kind(), std::io::ErrorKind::WouldBlock);
        service.cursor_credential = |_, _| Ok(auth::Credential { token: "another-fake-cursor-token".into() });
        let failure = tauri::async_runtime::block_on(service.cursor(root, false, None)).err().unwrap();
        assert_ne!(failure.code, "rate_limited");
        assert!(failure.retry_at.is_none());
        assert!(proxy.accept().is_ok(), "a different sign-in must reach the network");
    }

    #[test]
    fn claude_manual_refresh_bypasses_success_cache_but_never_a_rate_limit_cooldown() {
        let proxy = listener();
        let mut service = offline(&proxy);
        service.claude_credential = |_, _| Ok(claude::SignIn { credential: auth::Credential { token: "synthetic-claude-token".into() }, plan: "Team".into() });
        let root = std::env::temp_dir().join("meterluma-claude-manual-refresh-fixture");
        let key = cooldowns::key(ProviderId::Claude, &root);
        let fingerprint = (service.claude_credential)(&root, false).unwrap().credential.fingerprint();
        let snapshot = map::map(ProviderId::Claude, &serde_json::json!({"five_hour":{"utilization":77,"resets_at":"2099-01-01T00:00:00Z"}})).unwrap();
        tauri::async_runtime::block_on(async {
            service.local.lock().await.insert(key.clone(), Cache { fingerprint, checked_at: Instant::now(), until: Instant::now() + Duration::from_secs(29), result: Ok(snapshot) });
            assert_eq!(service.local_usage(ProviderId::Claude, root.clone(), false, None).await.ok().unwrap().metrics[0].used_percent, 77.0);
            assert_eq!(proxy.accept().err().unwrap().kind(), std::io::ErrorKind::WouldBlock);
            service.cooldowns.lock().unwrap().set(key.clone(), &fingerprint, 3600);
            let failure = service.local_usage(ProviderId::Claude, root.clone(), false, Some(Instant::now())).await.err().unwrap();
            assert_eq!(failure.code, "rate_limited");
            assert_eq!(proxy.accept().err().unwrap().kind(), std::io::ErrorKind::WouldBlock);
            service.cooldowns.lock().unwrap().remove(&key);
            let failure = service.local_usage(ProviderId::Claude, root, false, Some(Instant::now())).await.err().unwrap();
            assert_ne!(failure.code, "rate_limited");
            assert!(proxy.accept().is_ok(), "manual refresh must reach the network instead of returning the old 23% remaining");
        });
    }

    #[test]
    fn claude_success_cache_expires_before_each_adaptive_poll() {
        // Boundaries: healthy / exactly 25% left / almost exhausted / exhausted; weekly alone stays at one minute.
        for (session, seconds) in [(0.0, 59), (74.9, 59), (75.0, 29), (99.9, 29), (100.0, 59)] {
            let snapshot = map::map(ProviderId::Claude, &serde_json::json!({"five_hour":{"utilization":session},"seven_day":{"utilization":99}})).unwrap();
            assert_eq!(claude_cache_seconds(&snapshot), seconds);
        }
    }

    static CODEX_RUNS: AtomicUsize = AtomicUsize::new(0);
    fn fake_codex(_: &Path) -> Result<serde_json::Value, String> {
        CODEX_RUNS.fetch_add(1, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(300));
        Ok(serde_json::json!({"rateLimits":{"primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":4_102_444_800i64}}}))
    }
    static FAILED_RUNS: AtomicUsize = AtomicUsize::new(0);
    fn failing_codex(_: &Path) -> Result<serde_json::Value, String> {
        FAILED_RUNS.fetch_add(1, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(300));
        Err("Codex quota lookup timed out. Local history is still available.".into())
    }
    fn concurrently(service: &Arc<ProviderService>, root: &Path, count: usize) -> Vec<Result<Snapshot, String>> {
        let tasks: Vec<_> = (0..count).map(|_| { let (service, root) = (service.clone(), root.to_path_buf()); tauri::async_runtime::spawn(async move { service.codex(root, None).await }) }).collect();
        tasks.into_iter().map(|task| tauri::async_runtime::block_on(task).unwrap()).collect()
    }

    #[test]
    fn codex_lookups_are_coalesced_and_briefly_cached_per_profile() {
        let mut service = ProviderService::with_cache(None).unwrap();
        service.codex_runner = fake_codex;
        let service = Arc::new(service);
        let fixture = std::env::temp_dir().join(format!("meterluma-codex-cache-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        let (first, second) = (fixture.join("a"), fixture.join("b"));
        for root in [&first, &second] { std::fs::create_dir_all(root).unwrap(); std::fs::write(root.join("auth.json"), b"synthetic-account-one").unwrap(); }
        for result in concurrently(&service, &first, 3) { assert_eq!(result.ok().unwrap().metrics[0].used_percent, 25.0); }
        assert_eq!(CODEX_RUNS.load(Ordering::SeqCst), 1);
        assert!(tauri::async_runtime::block_on(service.codex(first.clone(), None)).is_ok());
        assert_eq!(CODEX_RUNS.load(Ordering::SeqCst), 1);
        // A manual refresh, such as after using a banked reset on the website, must not return the cached allowance.
        assert!(tauri::async_runtime::block_on(service.codex(first.clone(), Some(Instant::now()))).is_ok());
        assert_eq!(CODEX_RUNS.load(Ordering::SeqCst), 2);
        // Manual refreshes that overlap an in-flight lookup still share that one CLI run.
        let asked = Instant::now();
        let tasks: Vec<_> = (0..3).map(|_| { let (service, root) = (service.clone(), first.clone()); tauri::async_runtime::spawn(async move { service.codex(root, Some(asked)).await }) }).collect();
        for task in tasks { assert!(tauri::async_runtime::block_on(task).unwrap().is_ok()); }
        assert_eq!(CODEX_RUNS.load(Ordering::SeqCst), 3);
        // A different account in the same home must bypass the five-minute cache.
        std::fs::write(first.join("auth.json"), b"synthetic-account-two").unwrap();
        assert!(tauri::async_runtime::block_on(service.codex(first.clone(), None)).is_ok());
        assert_eq!(CODEX_RUNS.load(Ordering::SeqCst), 4);
        assert!(tauri::async_runtime::block_on(service.codex(second, None)).is_ok());
        assert_eq!(CODEX_RUNS.load(Ordering::SeqCst), 5);
        let slot = service.codex.lock().unwrap()[&cooldowns::key(ProviderId::Codex, &first)].clone();
        if let Some(earlier) = Instant::now().checked_sub(CODEX_FRESH + Duration::from_secs(1)) { slot.try_lock().unwrap().as_mut().unwrap().done = earlier; }
        assert!(tauri::async_runtime::block_on(service.codex(first, None)).is_ok());
        assert_eq!(CODEX_RUNS.load(Ordering::SeqCst), 6);
        std::fs::remove_dir_all(fixture).unwrap();
    }

    #[test]
    fn concurrent_codex_failures_are_shared_but_never_cached() {
        let mut service = ProviderService::with_cache(None).unwrap();
        service.codex_runner = failing_codex;
        let service = Arc::new(service);
        let root = std::env::temp_dir().join("meterluma-codex-profile-failing");
        for result in concurrently(&service, &root, 2) { assert!(result.err().unwrap().contains("timed out")); }
        assert_eq!(FAILED_RUNS.load(Ordering::SeqCst), 1);
        assert!(tauri::async_runtime::block_on(service.codex(root, None)).is_err());
        assert_eq!(FAILED_RUNS.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn cursor_requests_are_fixed_https_usage_only_with_an_honest_user_agent_and_no_redirects() {
        let service = ProviderService::with_cache(None).unwrap();
        let request = service.usage_request("test-token").build().unwrap();
        assert_eq!(request.url().scheme(), "https"); assert_eq!(request.url().host_str(), Some("api2.cursor.sh")); assert_eq!(request.url().path(), "/aiserver.v1.DashboardService/GetCurrentPeriodUsage");
        assert_eq!(request.headers()["authorization"], "Bearer test-token");
        let claude = service.local_usage_request(ProviderId::Claude, "test-claude-token").build().unwrap();
        assert_eq!(claude.method(), reqwest::Method::GET);
        assert_eq!(claude.url().as_str(), "https://api.anthropic.com/api/oauth/usage");
        assert_eq!(claude.headers()["authorization"], "Bearer test-claude-token");
        assert_eq!(claude.headers()["anthropic-beta"], "oauth-2025-04-20");
        assert!(claude.body().is_none());
        assert_eq!(USER_AGENT, format!("MeterLuma/{}", env!("CARGO_PKG_VERSION")));
        let (result, _, sent) = response("302 Found", "Location: http://127.0.0.1:9/never-follow\r\n", String::new());
        assert!(result.err().unwrap().contains("HTTP 302"));
        assert!(sent.contains(&format!("\r\nuser-agent: meterluma/{}\r\n", env!("CARGO_PKG_VERSION"))), "{sent}");
        assert!(!sent.contains("claude"));
    }

    #[test]
    fn http_errors_do_not_expose_response_secrets_and_throttling_is_bounded() {
        let (result, _, _) = response("401 Unauthorized", "", "private-token private-account".into());
        let error = result.err().unwrap(); assert!(error.contains("Sign in again")); assert!(!error.contains("private-"));
        let (result, retry, _) = response("429 Too Many Requests", "Retry-After: 7\r\n", "private-token".into());
        assert_eq!(retry, 30); assert!(result.is_err());
        let (_, retry, _) = response("429 Too Many Requests", "Retry-After: 172800\r\n", String::new());
        assert_eq!(retry, cooldowns::CAP_SECONDS);
    }

    #[test]
    fn live_transport_preserves_missing_resets_and_rejects_oversized_payloads() {
        let (result, retry, _) = response("200 OK", "", r#"{"planUsage":{"totalPercentUsed":42}}"#.into());
        let snapshot = result.unwrap(); assert_eq!(snapshot.metrics[0].used_percent, 42.0); assert_eq!(snapshot.metrics[0].reset_at, None); assert_eq!(retry, 300);
        let (result, _, _) = response("200 OK", "", "x".repeat(1_048_577)); assert!(result.err().unwrap().contains("large"));
    }

    #[test]
    fn tls_and_connection_failures_have_distinct_helpful_messages() {
        let client = client_builder().no_proxy().timeout(Duration::from_secs(5)).build().unwrap();
        let plain = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = plain.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = plain.accept().unwrap();
            let mut hello = [0; 512]; let _ = socket.read(&mut hello);
            let _ = socket.write_all(b"HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        });
        let (tls, _) = tauri::async_runtime::block_on(response_result(client.get(format!("https://{address}")), ProviderId::Cursor));
        server.join().unwrap();
        let tls = tls.err().unwrap();
        assert!(tls.starts_with("A secure connection to the provider could not be verified."), "{tls}");
        let closed = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
        let (refused, _) = tauri::async_runtime::block_on(response_result(client.get(format!("http://{closed}")), ProviderId::Cursor));
        let refused = refused.err().unwrap();
        assert!(refused.starts_with("MeterLuma could not connect to the provider."), "{refused}");
        assert_ne!(tls, refused);
    }

    #[test]
    fn startup_removes_only_the_two_legacy_cache_files_and_caches_live_in_the_app_cache_folder() {
        let cache = std::env::temp_dir().join(format!("meterluma-legacy-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        let legacy = cache.join("MeterLuma");
        std::fs::create_dir_all(&legacy).unwrap();
        for name in ["quota-snapshots-v1.json", "usage-cooldowns-v1.json", "MeterLuma.exe", "uninstall.exe", "quota-snapshots-v1.tmp-1"] { std::fs::write(legacy.join(name), b"fixture").unwrap(); }
        remove_legacy(&cache);
        let mut left: Vec<_> = std::fs::read_dir(&legacy).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        assert_eq!(left, ["MeterLuma.exe", "quota-snapshots-v1.tmp-1", "uninstall.exe"]);
        remove_legacy(&cache);
        let config: serde_json::Value = serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(config["identifier"], CACHE_FOLDER);
        let folder = cache.join(CACHE_FOLDER);
        let service = ProviderService::with_cache(Some(folder.clone())).unwrap();
        service.cooldowns.lock().unwrap().set("cursor:profile".into(), &[1; 32], 60);
        assert!(folder.join("usage-cooldowns-v2.json").is_file());
        let _ = std::fs::remove_dir_all(cache);
    }

    #[test]
    #[ignore = "Requires a signed-in local provider; opt in with METERLUMA_LIVE_PROVIDER=claude, cursor or codex."]
    fn live_provider_smoke() {
        let id = match std::env::var("METERLUMA_LIVE_PROVIDER").as_deref() { Ok("claude") => ProviderId::Claude, Ok("cursor") => ProviderId::Cursor, Ok("codex") => ProviderId::Codex, _ => panic!("Set METERLUMA_LIVE_PROVIDER to claude, cursor or codex.") };
        let service = ProviderService::new().unwrap();
        let lookup = async { if matches!(id, ProviderId::Claude) { service.refresh_claude(None, None).await } else { service.refresh(id, None, None).await } };
        match tauri::async_runtime::block_on(lookup) {
            Ok(snapshot) => { assert!(!snapshot.metrics.is_empty()); for metric in snapshot.metrics { println!("{} {}: {}% remaining", snapshot.name, metric.label, 100.0 - metric.used_percent); } },
            Err(failure) => panic!("Live connection unavailable: {}", failure.message),
        }
    }
}
