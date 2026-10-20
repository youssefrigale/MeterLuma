use super::{codex, response_result, tokens::{self, AccountToken}, Cache, ProviderFailure, ProviderId, ProviderService, Snapshot};
use std::time::{Duration, Instant};

fn key(id: ProviderId) -> Result<&'static str, String> {
    match id { ProviderId::Codex => Ok("token:codex"), ProviderId::Cursor => Ok("token:cursor"), ProviderId::Claude => Err("Claude subscription tokens are not supported. Its local history connection is optional.".into()) }
}
fn failure(message: String) -> ProviderFailure { ProviderFailure::new(message, None, None) }
fn token_error(message: String) -> String {
    if message.contains("sign-in") || message.starts_with("Sign in") { "The account token has expired or cannot read subscription limits. Replace it in Connections.".into() } else { message }
}

impl ProviderService {
    async fn token_lookup(&self, id: ProviderId, token: &AccountToken) -> (Result<Snapshot, String>, u64) {
        match id {
            ProviderId::Cursor => {
                let (result, lifetime) = response_result(self.usage_request(&token.access_token), id).await;
                (result.map_err(token_error), lifetime)
            }
            ProviderId::Codex => {
                let token = token.clone();
                let result = tauri::async_runtime::spawn_blocking(move || codex::limits_with_token(&token)).await
                    .map_err(|_| "The Codex token lookup could not complete.".to_string()).and_then(|v| v)
                    .and_then(|value| super::map::map(id, &codex::normalized(&value)));
                let lifetime = if result.is_ok() { 290 } else { 30 };
                (result, lifetime)
            }
            ProviderId::Claude => (Err("Claude subscription tokens are not supported.".into()), 30),
        }
    }

    pub async fn refresh_token(&self, id: ProviderId) -> Result<Snapshot, ProviderFailure> {
        let key = key(id).map_err(failure)?.to_string();
        let mut cache = self.manual.lock().await;
        let token = tokens::load(id).map_err(failure)?;
        let fingerprint = token.fingerprint();
        if self.cooldowns.lock().ok().and_then(|store| store.until(&key, &fingerprint)).is_some() {
            return Err(self.quota_failure("The provider is limiting requests. Wait for the retry time.".into(), &key, fingerprint, id));
        }
        if let Some(saved) = cache.get(&key).filter(|c| c.fingerprint == fingerprint && c.until > Instant::now()) {
            return saved.result.clone().map_err(|message| self.quota_failure(message, &key, fingerprint, id));
        }
        let (result, seconds) = self.token_lookup(id, &token).await;
        if tokens::load(id).map(|current| current.fingerprint() != fingerprint).unwrap_or(true) {
            cache.remove(&key);
            return Err(failure("The saved account token changed during refresh. Try again.".into()));
        }
        if result.as_ref().err().is_some_and(|e| e.starts_with("The provider is limiting requests.")) {
            if let Ok(mut store) = self.cooldowns.lock() { store.set(key.clone(), &fingerprint, seconds); }
        }
        if let Ok(snapshot) = &result { if let Ok(mut store) = self.snapshots.lock() { store.put(key.clone(), fingerprint, snapshot.clone()); } }
        cache.insert(key.clone(), Cache { fingerprint, until: Instant::now() + Duration::from_secs(seconds), result: result.clone() });
        result.map_err(|message| self.quota_failure(message, &key, fingerprint, id))
    }

    async fn connect_token(&self, id: ProviderId, token: AccountToken) -> Result<Snapshot, ProviderFailure> {
        let key = key(id).map_err(failure)?.to_string();
        let mut cache = self.manual.lock().await;
        let fingerprint = token.fingerprint();
        if self.cooldowns.lock().ok().and_then(|s| s.until(&key, &fingerprint)).is_some() {
            return Err(self.quota_failure("The provider is limiting requests. Wait for the retry time.".into(), &key, fingerprint, id));
        }
        let (result, seconds) = self.token_lookup(id, &token).await;
        let snapshot = match result {
            Ok(value) => value,
            Err(message) => {
                if message.starts_with("The provider is limiting requests.") { if let Ok(mut store) = self.cooldowns.lock() { store.set(key.clone(), &fingerprint, seconds); } }
                return Err(self.quota_failure(message, &key, fingerprint, id));
            }
        };
        // Only an accepted token is saved. A failed replacement keeps the old one.
        tokens::save(id, &token).map_err(failure)?;
        if let Ok(mut store) = self.cooldowns.lock() { store.remove(&key); }
        if let Ok(mut store) = self.snapshots.lock() { store.remove(&key); store.put(key.clone(), fingerprint, snapshot.clone()); }
        cache.insert(key, Cache { fingerprint, until: Instant::now() + Duration::from_secs(seconds), result: Ok(snapshot.clone()) });
        Ok(snapshot)
    }
}

#[tauri::command]
pub async fn connect_account_token(service: tauri::State<'_, ProviderService>, provider_id: ProviderId, token: String, account_id: Option<String>) -> Result<Snapshot, ProviderFailure> {
    let token = AccountToken::parse(provider_id, token, account_id).map_err(failure)?;
    service.connect_token(provider_id, token).await
}

#[tauri::command]
pub async fn forget_account_token(service: tauri::State<'_, ProviderService>, provider_id: ProviderId) -> Result<(), String> {
    let key = key(provider_id)?;
    let mut cache = service.manual.lock().await;
    tokens::forget(provider_id)?;
    cache.remove(key);
    if let Ok(mut store) = service.snapshots.lock() { store.remove(key); }
    if let Ok(mut store) = service.cooldowns.lock() { store.remove(key); }
    Ok(())
}
