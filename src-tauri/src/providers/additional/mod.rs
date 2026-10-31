mod byteplus;
pub(crate) mod catalog;
mod command;
mod local;
mod mappers;
mod provider_list;
mod qoder;

use super::{cooldowns::Cooldowns, tokens, Metric};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Amount {
    pub label: String,
    pub value: f64,
    pub currency: Option<String>,
    pub unit: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: String,
    pub name: String,
    pub plan: Option<String>,
    pub metrics: Vec<Metric>,
    pub amounts: Vec<Amount>,
    pub fetched_at: i64,
    pub cached: bool,
    pub notice: Option<String>,
    pub warning: bool,
}
impl Snapshot {
    fn new(spec: &catalog::ProviderSpec) -> Self {
        Self {
            id: spec.id.clone(),
            name: spec.name.clone(),
            plan: None,
            metrics: Vec::new(),
            amounts: Vec::new(),
            fetched_at: chrono::Utc::now().timestamp_millis(),
            cached: false,
            notice: None,
            warning: false,
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub code: String,
    pub message: String,
    pub retry_at: Option<i64>,
    pub last_snapshot: Option<Snapshot>,
}
impl Failure {
    fn unavailable(message: impl Into<String>) -> Self {
        Self {
            code: "unavailable".into(),
            message: message.into(),
            retry_at: None,
            last_snapshot: None,
        }
    }
}
struct Cached {
    fingerprint: [u8; 32],
    until: Instant,
    snapshot: Snapshot,
}
impl Cached {
    fn matches(&self, fingerprint: [u8; 32], now: i64) -> bool {
        self.fingerprint == fingerprint
            && (0..=300_000).contains(&now.saturating_sub(self.snapshot.fetched_at))
    }
    fn fresh(&self, fingerprint: [u8; 32]) -> bool {
        let now = chrono::Utc::now().timestamp_millis();
        self.matches(fingerprint, now)
            && self.until > Instant::now()
            && self
                .snapshot
                .metrics
                .iter()
                .all(|metric| metric.reset_at.is_none_or(|reset| reset > now))
    }
}
async fn credential(id: &str) -> Result<tokens::AccountToken, String> {
    let id = id.to_string();
    tauri::async_runtime::spawn_blocking(move || tokens::external_load(&id))
        .await
        .map_err(|_| "The saved provider credential could not be read.".to_string())?
}
async fn save_credential(id: &str, raw: &str) -> Result<(), String> {
    let (id, raw) = (id.to_string(), raw.to_string());
    tauri::async_runtime::spawn_blocking(move || tokens::external_save(&id, &raw))
        .await
        .map_err(|_| "The provider credential could not be saved.".to_string())?
}
async fn forget_credential(id: &str) -> Result<(), String> {
    let id = id.to_string();
    tauri::async_runtime::spawn_blocking(move || tokens::external_forget(&id))
        .await
        .map_err(|_| "The saved provider credential could not be removed.".to_string())?
}
pub struct AdditionalService {
    client: reqwest::Client,
    caches: Mutex<HashMap<String, Cached>>,
    cooldowns: Mutex<Cooldowns>,
    gates: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    requests: tokio::sync::Semaphore,
    local_reads: tokio::sync::Semaphore,
    provider_list: provider_list::ProviderList,
}
impl AdditionalService {
    pub fn new() -> Result<Self, reqwest::Error> {
        let folder = dirs::cache_dir().map(|root| root.join(super::CACHE_FOLDER));
        Self::with_cache(
            folder.as_ref().map(|folder| folder.join("additional-cooldowns-v1.json")),
            provider_list::ProviderList::new(folder.map(|folder| folder.join("provider-list-v1.json"))),
        )
    }
    fn with_cache(
        path: Option<std::path::PathBuf>,
        provider_list: provider_list::ProviderList,
    ) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: super::client_builder().build().or_else(|_| {
                super::client_builder()
                    .tls_built_in_native_certs(false)
                    .build()
            })?,
            caches: Default::default(),
            gates: Default::default(),
            requests: tokio::sync::Semaphore::new(4),
            local_reads: tokio::sync::Semaphore::new(2),
            cooldowns: Mutex::new(Cooldowns::load(path)),
            provider_list,
        })
    }
    fn gate(&self, id: &str) -> Arc<tokio::sync::Mutex<()>> {
        let mut gates = self
            .gates
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        gates.retain(|_, gate| Arc::strong_count(gate) > 1);
        gates.entry(id.into()).or_default().clone()
    }
    fn failure(&self, id: &str, fingerprint: [u8; 32], mut failure: Failure) -> Failure {
        failure.retry_at = self
            .cooldowns
            .lock()
            .ok()
            .and_then(|store| store.until(id, &fingerprint));
        let now = chrono::Utc::now().timestamp_millis();
        failure.last_snapshot = self.caches.lock().ok().and_then(|cache| {
            cache
                .get(id)
                .filter(|cached| cached.matches(fingerprint, now))
                .map(|cached| {
                    let mut snapshot = cached.snapshot.clone();
                    snapshot.cached = true;
                    snapshot
                        .metrics
                        .retain(|metric| metric.reset_at.is_none_or(|reset| reset > now));
                    snapshot
                })
        });
        failure
    }
    async fn fetch(
        &self,
        spec: &catalog::ProviderSpec,
        credential: &str,
    ) -> Result<Snapshot, Failure> {
        let _permit = self
            .requests
            .acquire()
            .await
            .map_err(|_| Failure::unavailable("Provider refreshes are unavailable."))?;
        let fingerprint = tokens::AccountToken {
            access_token: credential.into(),
            account_id: None,
        }
        .fingerprint();
        if self
            .cooldowns
            .lock()
            .ok()
            .and_then(|store| store.until(&spec.id, &fingerprint))
            .is_some()
        {
            return Err(self.failure(
                &spec.id,
                fingerprint,
                Failure {
                    code: "rate_limited".into(),
                    message: "The provider is limiting usage requests. Wait for its retry time."
                        .into(),
                    retry_at: None,
                    last_snapshot: None,
                },
            ));
        }
        let (responses, failures) = self.endpoints(spec, credential, fingerprint).await;
        let mut snapshot = Snapshot::new(spec);
        let usage = mappers::map(&spec.id, &responses).map_err(|message| {
            self.failure(
                &spec.id,
                fingerprint,
                failures
                    .first()
                    .cloned()
                    .unwrap_or_else(|| Failure::unavailable(message)),
            )
        })?;
        snapshot.plan = usage.plan;
        snapshot.metrics = usage.metrics;
        snapshot.amounts = usage.amounts;
        snapshot.notice = usage.notice;
        snapshot.warning = usage.warning || !failures.is_empty();
        if !failures.is_empty() && snapshot.notice.is_none() {
            snapshot.notice = Some("Some provider fields are unavailable for this credential. Available values are shown.".into());
        }
        Ok(snapshot)
    }
    async fn endpoints(
        &self,
        spec: &catalog::ProviderSpec,
        credential: &str,
        fingerprint: [u8; 32],
    ) -> (mappers::Responses, Vec<Failure>) {
        let (mut responses, mut failures) = (mappers::Responses::new(), Vec::new());
        for endpoint in &spec.requests {
            match self.request(spec, endpoint, credential).await {
                Ok(response) => {
                    responses.insert(endpoint.key.clone(), response);
                }
                Err(failure) => {
                    let limited = failure.code == "rate_limited";
                    if let Some(until) = failure.retry_at {
                        let seconds = until
                            .saturating_sub(chrono::Utc::now().timestamp_millis())
                            .max(30_000) as u64
                            / 1000;
                        if let Ok(mut store) = self.cooldowns.lock() {
                            store.set(spec.id.clone(), &fingerprint, seconds);
                        }
                    }
                    failures.push(failure);
                    if limited {
                        break;
                    }
                }
            }
        }
        (responses, failures)
    }
    async fn request(
        &self,
        spec: &catalog::ProviderSpec,
        endpoint: &catalog::Endpoint,
        credential: &str,
    ) -> Result<serde_json::Value, Failure> {
        let scoped = spec
            .credential_scope
            .as_ref()
            .map(|scope| scoped_credential(credential, &scope.field))
            .transpose()?;
        let credential = scoped
            .as_ref()
            .map(|(token, _)| token.as_str())
            .unwrap_or(credential);
        let header = if spec.auth_header == "Authorization" {
            let prefix = spec.auth_prefix.as_deref().unwrap_or("Bearer ");
            let prefix = prefix.replace(
                "{scope}",
                scoped
                    .as_ref()
                    .map(|(_, scope)| scope.as_str())
                    .unwrap_or(""),
            );
            format!("{prefix}{credential}",)
        } else {
            credential.into()
        };
        let mut request = if let Some(body) = &endpoint.body {
            let mut body = body.clone();
            if spec
                .credential_scope
                .as_ref()
                .is_some_and(|scope| scope.field == "projectId")
            {
                if let Some((_, project)) = &scoped {
                    body["project"] = serde_json::Value::String(project.clone());
                }
            }
            if let Some(pointer) = &endpoint.credential_pointer {
                *body.pointer_mut(pointer).ok_or_else(|| {
                    Failure::unavailable("The built-in provider request is invalid.")
                })? = serde_json::Value::String(credential.into());
            }
            let request = self.client.post(&endpoint.url);
            match endpoint.body_encoding {
                catalog::BodyEncoding::Json => request.json(&body),
                catalog::BodyEncoding::Form => request.form(&body),
            }
        } else {
            if spec.id == "fireworks" {
                self.client.get(fireworks_url(
                    &endpoint.url,
                    &scoped
                        .as_ref()
                        .ok_or_else(|| {
                            Failure::unavailable("The Fireworks account ID is missing.")
                        })?
                        .1,
                )?)
            } else {
                self.client.get(&endpoint.url)
            }
        };
        request = request.header("Accept", "application/json");
        if !spec.auth_header.is_empty() {
            request = request.header(&spec.auth_header, header);
        }
        for (name, value) in &spec.headers {
            request = request.header(name, value);
        }
        let response = request
            .send()
            .await
            .map_err(|error| Failure::unavailable(super::transport_error(&error)))?;
        json_response(response).await
    }
    pub async fn refresh(&self, id: &str) -> Result<Snapshot, Failure> {
        let spec = catalog::ready(id).map_err(Failure::unavailable)?;
        let gate = self.gate(id);
        let _turn = gate.lock().await;
        if spec.source != "api" {
            return self.local_snapshot(spec).await;
        }
        let credential = credential(id).await.map_err(Failure::unavailable)?;
        let fingerprint = credential.fingerprint();
        if let Some(cached) = self.caches.lock().ok().and_then(|cache| {
            cache
                .get(id)
                .filter(|cached| cached.fresh(fingerprint))
                .map(|cached| cached.snapshot.clone())
        }) {
            return Ok(cached);
        }
        let spec = self.provider_list.spec(&self.client, spec).await;
        let snapshot = self.fetch(&spec, &credential.access_token).await?;
        if self::credential(id)
            .await
            .map(|current| current.fingerprint() != fingerprint)
            .unwrap_or(true)
        {
            return Err(Failure::unavailable(
                "The provider credential changed during refresh. Try again.",
            ));
        }
        if let Ok(mut caches) = self.caches.lock() {
            caches.insert(
                id.into(),
                Cached {
                    fingerprint,
                    until: Instant::now() + Duration::from_secs(290),
                    snapshot: snapshot.clone(),
                },
            );
        }
        Ok(snapshot)
    }
    pub async fn connect(&self, id: &str, raw: &str) -> Result<Snapshot, Failure> {
        let spec = catalog::ready(id).map_err(Failure::unavailable)?;
        let gate = self.gate(id);
        let _turn = gate.lock().await;
        if spec.source != "api" {
            return self.local_snapshot(spec).await;
        }
        let credential = tokens::external_credential(raw).map_err(Failure::unavailable)?;
        let spec = self.provider_list.spec(&self.client, spec).await;
        let snapshot = self.fetch(&spec, &credential).await?;
        save_credential(id, &credential)
            .await
            .map_err(Failure::unavailable)?;
        let fingerprint = tokens::AccountToken {
            access_token: credential,
            account_id: None,
        }
        .fingerprint();
        if let Ok(mut caches) = self.caches.lock() {
            caches.insert(
                id.into(),
                Cached {
                    fingerprint,
                    until: Instant::now() + Duration::from_secs(290),
                    snapshot: snapshot.clone(),
                },
            );
        }
        Ok(snapshot)
    }
    pub async fn forget(&self, id: &str) -> Result<(), String> {
        let spec = catalog::provider(id)?;
        let gate = self.gate(id);
        let _turn = gate.lock().await;
        if spec.source == "api" {
            forget_credential(id).await?;
        }
        if let Ok(mut caches) = self.caches.lock() {
            caches.remove(id);
        }
        if let Ok(mut cooldowns) = self.cooldowns.lock() {
            cooldowns.remove(id);
        }
        Ok(())
    }
    async fn local_snapshot(
        &self,
        spec: &'static catalog::ProviderSpec,
    ) -> Result<Snapshot, Failure> {
        let _permit = self
            .local_reads
            .acquire()
            .await
            .map_err(|_| Failure::unavailable("Local usage readers are unavailable."))?;
        if spec.source == "cli" {
            match spec.id.as_str() {
                "qoder" => qoder::snapshot(spec).await,
                "byteplus" => byteplus::snapshot(spec).await,
                _ => Err(Failure::unavailable(
                    "This provider has no CLI usage reader.",
                )),
            }
        } else {
            local::snapshot(spec).await
        }
    }
}

fn scoped_credential(raw: &str, field: &str) -> Result<(String, String), Failure> {
    let value: serde_json::Value = serde_json::from_str(raw).map_err(|_| {
        Failure::unavailable("Enter the provider access token and its project or account ID.")
    })?;
    let token = value["accessToken"]
        .as_str()
        .ok_or_else(|| Failure::unavailable("The provider access token is missing."))?;
    let token = tokens::external_credential(token).map_err(Failure::unavailable)?;
    let project = value[field]
        .as_str()
        .filter(|project| {
            !project.is_empty()
                && project.len() <= 128
                && project.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric()
                        || (if field == "accountId" {
                            b"-_".as_slice()
                        } else {
                            b"-_.:".as_slice()
                        })
                        .contains(&byte)
                })
        })
        .ok_or_else(|| Failure::unavailable("Enter a valid provider project or account ID."))?;
    if field == "userId" && project.parse::<u32>().ok().is_none_or(|user| user == 0) {
        return Err(Failure::unavailable(
            "Enter your positive numeric Zed user ID.",
        ));
    }
    Ok((token, project.into()))
}

fn fireworks_url(endpoint: &str, account: &str) -> Result<reqwest::Url, Failure> {
    let mut url = reqwest::Url::parse(&endpoint.replace("{account_id}", account))
        .map_err(|_| Failure::unavailable("The Fireworks usage endpoint is invalid."))?;
    let today = chrono::Utc::now().date_naive();
    let start = today
        .checked_sub_days(chrono::Days::new(29))
        .ok_or_else(|| Failure::unavailable("The billing date range is unavailable."))?;
    let end = today
        .succ_opt()
        .ok_or_else(|| Failure::unavailable("The billing date range is unavailable."))?;
    url.query_pairs_mut()
        .append_pair("startTime", &format!("{start}T00:00:00Z"))
        .append_pair("endTime", &format!("{end}T00:00:00Z"));
    Ok(url)
}

fn http_failure(response: &reqwest::Response) -> Option<Failure> {
    let status = response.status();
    if status.as_u16() == 429 {
        let now = chrono::Utc::now().timestamp_millis();
        let seconds = super::cooldowns::retry_seconds(
            response
                .headers()
                .get("Retry-After")
                .and_then(|header| header.to_str().ok()),
            now,
        );
        return Some(Failure {
            code: "rate_limited".into(),
            message: "The provider is limiting usage requests.".into(),
            retry_at: Some(now + seconds as i64 * 1000),
            last_snapshot: None,
        });
    }
    if matches!(status.as_u16(), 401 | 403) {
        return Some(Failure { code: "sign_in_required".into(), message: "This credential cannot read the provider's usage data. Check its permissions or replace it.".into(), retry_at: None, last_snapshot: None });
    }
    (!status.is_success()).then(|| {
        Failure::unavailable(format!(
            "The provider usage request failed (HTTP {}).",
            status.as_u16()
        ))
    })
}
async fn json_response(mut response: reqwest::Response) -> Result<serde_json::Value, Failure> {
    if let Some(failure) = http_failure(&response) {
        return Err(failure);
    }
    if response
        .content_length()
        .is_some_and(|length| length > 1_048_576)
    {
        return Err(Failure::unavailable(
            "The provider usage response is too large.",
        ));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| Failure::unavailable("The provider usage response could not be read."))?
    {
        if bytes.len() + chunk.len() > 1_048_576 {
            return Err(Failure::unavailable(
                "The provider usage response is too large.",
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| Failure::unavailable("The provider usage response has an unsupported format."))
}

#[tauri::command]
pub async fn refresh_additional_provider(
    service: tauri::State<'_, AdditionalService>,
    provider_id: String,
) -> Result<Snapshot, Failure> {
    service.refresh(&provider_id).await
}
#[tauri::command]
pub async fn connect_additional_provider(
    service: tauri::State<'_, AdditionalService>,
    provider_id: String,
    token: String,
) -> Result<Snapshot, Failure> {
    service.connect(&provider_id, &token).await
}
#[tauri::command]
pub async fn forget_additional_provider(
    service: tauri::State<'_, AdditionalService>,
    provider_id: String,
) -> Result<(), String> {
    service.forget(&provider_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    fn server(status: u16, body: &str) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let body = body.to_string();
        let worker = std::thread::spawn(move || {
            let mut requests = Vec::new();
            let deadline = Instant::now() + Duration::from_secs(15);
            let mut last = Instant::now();
            while Instant::now() < deadline
                && (requests.is_empty() || last.elapsed() < Duration::from_millis(200))
            {
                match listener.accept() {
                    Ok((mut socket, _)) => {
                        socket.set_nonblocking(false).unwrap();
                        socket
                            .set_read_timeout(Some(Duration::from_secs(1)))
                            .unwrap();
                        let mut bytes = Vec::new();
                        let mut buffer = [0; 1024];
                        while bytes.len() < 16384 {
                            if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n")
                            {
                                let headers = String::from_utf8_lossy(&bytes[..end]);
                                let length = headers
                                    .lines()
                                    .find_map(|line| {
                                        line.split_once(':')
                                            .filter(|(name, _)| {
                                                name.eq_ignore_ascii_case("content-length")
                                            })
                                            .and_then(|(_, length)| {
                                                length.trim().parse::<usize>().ok()
                                            })
                                    })
                                    .unwrap_or(0);
                                if bytes.len() >= end + 4 + length {
                                    break;
                                }
                            }
                            let count = socket.read(&mut buffer).unwrap();
                            if count == 0 {
                                break;
                            }
                            bytes.extend_from_slice(&buffer[..count]);
                        }
                        requests.push(String::from_utf8(bytes).unwrap());
                        let response = format!("HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nRetry-After: 120\r\nConnection: close\r\n\r\n{body}", body.len());
                        let _ = socket.write_all(response.as_bytes());
                        last = Instant::now();
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2))
                    }
                    Err(error) => panic!("{error}"),
                }
            }
            requests
        });
        (url, worker)
    }
    fn service() -> AdditionalService {
        let mut service = AdditionalService::with_cache(None, provider_list::ProviderList::offline()).unwrap();
        service.client = super::super::client_builder().no_proxy().build().unwrap();
        service
    }
    #[test]
    fn scoped_tokens_route_only_the_selected_project_or_account_without_leaking_the_envelope() {
        for (id, field, identifier, route) in [
            ("gemini", "projectId", "fixture-project", "/quota"),
            (
                "fireworks",
                "accountId",
                "fixture-account",
                "/accounts/{account_id}/billing/summary",
            ),
            ("zed", "userId", "123", "/client/users/me"),
        ] {
            let (url, worker) = server(200, "{}");
            let mut spec = catalog::ready(id).unwrap().clone();
            spec.requests[0].url = format!("{url}{route}");
            let raw = serde_json::json!({"accessToken":"synthetic-scope-token",field:identifier})
                .to_string();
            assert!(tauri::async_runtime::block_on(service().request(
                &spec,
                &spec.requests[0],
                &raw
            ))
            .is_ok());
            let requests = worker.join().unwrap();
            assert_eq!(requests.len(), 1);
            assert!(requests[0].to_lowercase().contains(if id == "zed" {
                "authorization: 123 synthetic-scope-token\r\n"
            } else {
                "authorization: bearer synthetic-scope-token\r\n"
            }));
            assert!(!requests[0].contains("accessToken"));
            if id == "gemini" {
                let body: serde_json::Value =
                    serde_json::from_str(requests[0].split_once("\r\n\r\n").unwrap().1).unwrap();
                assert_eq!(body, serde_json::json!({"project":identifier}));
            } else if id == "fireworks" {
                assert!(requests[0]
                    .starts_with("GET /accounts/fixture-account/billing/summary?startTime="));
                let target = requests[0].split_whitespace().nth(1).unwrap();
                let parsed = reqwest::Url::parse(&format!("{url}{target}")).unwrap();
                let dates: HashMap<_, _> = parsed.query_pairs().collect();
                let start = chrono::DateTime::parse_from_rfc3339(&dates["startTime"]).unwrap();
                let end = chrono::DateTime::parse_from_rfc3339(&dates["endTime"]).unwrap();
                assert_eq!(end - start, chrono::Duration::days(30));
                assert_eq!(
                    end.date_naive().pred_opt().unwrap(),
                    chrono::Utc::now().date_naive()
                );
            } else {
                assert!(requests[0].starts_with("GET /client/users/me HTTP/1.1"));
            }
        }
        // Empty scope, traversal, URL delimiters and header injection must fail before any HTTP request.
        for identifier in [
            "",
            "../another-account",
            "a?admin=true",
            "x\r\nHost: elsewhere",
        ] {
            let raw = serde_json::json!({"accessToken":"synthetic-token","accountId":identifier})
                .to_string();
            assert!(scoped_credential(&raw, "accountId").is_err());
        }
        for identifier in ["0", "-1", "1 2", "4294967296", "not-a-user"] {
            let raw = serde_json::json!({"accessToken":"synthetic-token","userId":identifier})
                .to_string();
            assert!(scoped_credential(&raw, "userId").is_err());
        }
    }
    #[test]
    fn failed_refreshes_never_reuse_another_keys_data_future_snapshots_or_expired_quota_windows() {
        let service = service();
        let now = chrono::Utc::now().timestamp_millis();
        for (age, fingerprint, reset, expected) in [
            (1000, [1; 32], now + 10000, Some(1)),
            (1000, [2; 32], now + 10000, None),
            (-10000, [1; 32], now + 10000, None),
            (300001, [1; 32], now + 10000, None),
            (1000, [1; 32], now - 1000, Some(0)),
        ] {
            let mut snapshot = Snapshot::new(catalog::ready("deepseek").unwrap());
            snapshot.fetched_at = now - age;
            snapshot.metrics.push(Metric {
                label: "Session".into(),
                period_minutes: None,
                used_percent: 25.0,
                reset_at: Some(reset),
            });
            service.caches.lock().unwrap().insert(
                "deepseek".into(),
                Cached {
                    fingerprint: [1; 32],
                    until: Instant::now() + Duration::from_secs(60),
                    snapshot,
                },
            );
            let failure = service.failure(
                "deepseek",
                fingerprint,
                Failure::unavailable("Usage unavailable"),
            );
            assert_eq!(
                failure
                    .last_snapshot
                    .as_ref()
                    .map(|snapshot| snapshot.metrics.len()),
                expected
            );
            if let Some(snapshot) = failure.last_snapshot {
                assert!(snapshot.cached);
            }
        }
    }
    #[test]
    fn additional_balance_lookup_is_read_only_and_preserves_returned_currency() {
        let (url, server) = server(
            200,
            r#"{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"8.76"}]}"#,
        );
        let mut spec = catalog::ready("deepseek").unwrap().clone();
        spec.requests[0].url = format!("{url}/balance");
        let usage = tauri::async_runtime::block_on(service().fetch(&spec, "synthetic-api-key"))
            .ok()
            .unwrap();
        assert_eq!(usage.amounts[0].currency.as_deref(), Some("CNY"));
        assert_eq!(usage.amounts[0].value, 8.76);
        assert!(usage.metrics.is_empty());
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET /balance HTTP/1.1"));
        assert!(requests[0]
            .to_lowercase()
            .contains("authorization: bearer synthetic-api-key"));
    }
    #[test]
    fn regional_alibaba_requests_use_only_the_fixed_quota_query_and_form_body() {
        let future = chrono::Utc::now().timestamp_millis() + 3_600_000;
        let response = serde_json::json!({"data":{"DataV2":{"data":{"data":{"codingPlanInstanceInfos":[{"status":"VALID","codingPlanQuotaInfo":{"per5HourUsedQuota":1,"per5HourTotalQuota":10,"per5HourQuotaNextRefreshTime":future}}]}}}}}).to_string();
        for (id, region, commodity) in [
            ("alibaba", "ap-southeast-1", "sfm_codingplan_public_intl"),
            ("alibaba-cn", "cn-beijing", "sfm_codingplan_public_cn"),
        ] {
            let (url, worker) = server(200, &response);
            let mut spec = catalog::ready(id).unwrap().clone();
            let original = reqwest::Url::parse(&spec.requests[0].url).unwrap();
            spec.requests[0].url = format!("{url}/cli/api.json?{}", original.query().unwrap());
            let usage =
                tauri::async_runtime::block_on(service().fetch(&spec, "synthetic-console-token"))
                    .ok()
                    .unwrap();
            assert_eq!(usage.metrics[0].used_percent, 10.0);
            let requests = worker.join().unwrap();
            assert_eq!(requests.len(), 1);
            assert!(requests[0].starts_with("POST /cli/api.json?"));
            assert!(requests[0]
                .to_lowercase()
                .contains("content-type: application/x-www-form-urlencoded"));
            assert!(requests[0]
                .to_lowercase()
                .contains("authorization: bearer synthetic-console-token"));
            let body = requests[0].split_once("\r\n\r\n").unwrap().1;
            assert!(!body.contains("synthetic-console-token"));
            let form = reqwest::Url::parse(&format!("http://fixture.invalid/?{body}")).unwrap();
            let fields: HashMap<_, _> = form.query_pairs().collect();
            assert_eq!(fields["region"], region);
            let parameters: serde_json::Value = serde_json::from_str(&fields["params"]).unwrap();
            assert_eq!(
                parameters["Api"],
                "zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2"
            );
            assert_eq!(
                parameters["Data"]["queryCodingPlanInstanceInfoRequest"],
                serde_json::json!({"commodityCode":commodity,"onlyLatestOne":true})
            );
        }
    }
    #[test]
    fn companion_status_rpc_only_calls_get_user_status_and_preserves_exhausted_proto3_weekly_limits(
    ) {
        let (url, server) = server(
            200,
            r#"{"userStatus":{"planStatus":{"planInfo":{"planName":"Pro","hideDailyQuota":true},"weeklyQuotaResetAtUnix":"1894060800","overageBalanceMicros":"1250000"}}}"#,
        );
        let mut spec = catalog::ready("devin").unwrap().clone();
        spec.requests[0].url = format!("{url}/GetUserStatus");
        let usage =
            tauri::async_runtime::block_on(service().fetch(&spec, "synthetic-companion-key"))
                .ok()
                .unwrap();
        assert_eq!(usage.metrics[0].label, "Weekly");
        assert_eq!(usage.metrics[0].used_percent, 100.0);
        assert_eq!(usage.amounts[0].value, 1.25);
        let requests = server.join().unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("POST /GetUserStatus HTTP/1.1"));
        let body: serde_json::Value =
            serde_json::from_str(requests[0].split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["metadata"]["apiKey"], "synthetic-companion-key");
        assert_eq!(body["metadata"]["ideName"], "meterluma");
    }
    #[test]
    fn a_rate_limit_stops_other_endpoints_and_subsequent_polls_respect_the_credential_deadline() {
        let (url, server) = server(429, "{}");
        let service = service();
        let mut spec = catalog::ready("openrouter").unwrap().clone();
        for endpoint in &mut spec.requests {
            endpoint.url = format!("{url}/{}", endpoint.key);
        }
        for _ in 0..2 {
            let failure =
                tauri::async_runtime::block_on(service.fetch(&spec, "synthetic-limited-key"))
                    .err()
                    .unwrap();
            assert_eq!(failure.code, "rate_limited");
            assert!(failure.retry_at.unwrap() > chrono::Utc::now().timestamp_millis());
        }
        assert_eq!(server.join().unwrap().len(), 1);
    }
    #[test]
    fn oversized_usage_responses_are_rejected_without_echoing_credentials_or_payloads() {
        let (url, server) = server(
            200,
            &format!("{{\"private_payload\":\"{}\"}}", "x".repeat(1_048_576)),
        );
        let mut spec = catalog::ready("deepseek").unwrap().clone();
        spec.requests[0].url = url;
        let failure =
            tauri::async_runtime::block_on(service().fetch(&spec, "synthetic-private-key"))
                .err()
                .unwrap();
        assert!(failure.message.contains("too large"), "{}", failure.message);
        assert!(
            !failure.message.contains("synthetic-private-key")
                && !failure.message.contains("private_payload")
        );
        server.join().unwrap();
    }
}
