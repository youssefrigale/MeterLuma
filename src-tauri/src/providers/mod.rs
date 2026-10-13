mod auth;
mod map;

use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId { Claude, Codex, Cursor }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metric {
    pub label: String,
    pub used_percent: f64,
    pub reset_at: Option<i64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub id: ProviderId,
    pub name: String,
    pub plan: String,
    pub color: String,
    pub initials: String,
    pub spend_today: Option<f64>,
    pub metrics: Vec<Metric>,
}

struct Cache {
    fingerprint: [u8; 32],
    until: Instant,
    result: Result<Snapshot, String>,
}

pub struct ProviderService {
    client: reqwest::Client,
    caches: [Mutex<Option<Cache>>; 3],
}

impl ProviderService {
    pub fn new() -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none())
                .user_agent("MeterLuma/0.1.0").build()?,
            caches: std::array::from_fn(|_| Mutex::new(None)),
        })
    }

    pub async fn refresh(&self, id: ProviderId) -> Result<Snapshot, String> {
        let index = match id { ProviderId::Claude => 0, ProviderId::Codex => 1, ProviderId::Cursor => 2 };
        let mut cache = self.caches[index].lock().await;
        let credential = tauri::async_runtime::spawn_blocking(move || auth::load(id)).await
            .map_err(|_| "Your local sign-in could not be read.".to_string())??;
        let fingerprint = credential.fingerprint();
        if let Some(previous) = cache.as_ref() {
            if previous.fingerprint == fingerprint && previous.until > Instant::now() { return previous.result.clone(); }
        }
        let mut request = match id {
            ProviderId::Claude => self.client.get("https://api.anthropic.com/api/oauth/usage").header("anthropic-beta", "oauth-2025-04-20"),
            ProviderId::Codex => {
                let request = self.client.get("https://chatgpt.com/backend-api/wham/usage");
                if let Some(account) = &credential.account_id { request.header("ChatGPT-Account-Id", account) } else { request }
            }
            ProviderId::Cursor => self.client.post("https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage")
                .header("Connect-Protocol-Version", "1").json(&serde_json::json!({})),
        };
        request = request.bearer_auth(&credential.token).header("Accept", "application/json");
        let (result, retry_in) = match request.send().await {
            Err(_) => (Err("The provider could not be reached. Check your connection and try again.".into()), 30),
            Ok(mut response) => {
                let status = response.status();
                if status.as_u16() == 429 {
                    let retry = response.headers().get("retry-after").and_then(|value| value.to_str().ok())
                        .and_then(|value| value.parse::<u64>().ok()).unwrap_or(300).clamp(30, 86_400);
                    (Err(format!("The provider is limiting requests. MeterLuma will retry after {retry} seconds.")), retry)
                } else if status.as_u16() == 401 || status.as_u16() == 403 {
                    (Err("Your sign-in has expired or cannot read usage limits. Sign in again using the provider app.".into()), 30)
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
        };
        // A sign-in changed while the request was in flight: never return the previous account's data.
        let current = tauri::async_runtime::spawn_blocking(move || auth::load(id)).await
            .map_err(|_| "Your current sign-in could not be checked.".to_string())??;
        if current.fingerprint() != fingerprint {
            *cache = None;
            return Err("Your provider sign-in changed. Refresh again to read the current account.".into());
        }
        *cache = Some(Cache { fingerprint, until: Instant::now() + Duration::from_secs(retry_in), result: result.clone() });
        result
    }
}

#[tauri::command]
pub async fn refresh_provider(service: tauri::State<'_, ProviderService>, provider_id: ProviderId) -> Result<Snapshot, String> {
    service.refresh(provider_id).await
}
