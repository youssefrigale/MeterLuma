use super::{codex, response_result, tokens::{self, AccountToken}, Cache, ProviderFailure, ProviderId, ProviderService, Snapshot};
use std::time::{Duration, Instant};

fn key(id: ProviderId) -> Result<&'static str, String> {
    match id { ProviderId::Codex => Ok("token:codex"), ProviderId::Cursor => Ok("token:cursor"), ProviderId::Claude => Err("Claude subscription tokens are not supported. Its local history connection is optional.".into()) }
}
fn failure(message: String) -> ProviderFailure { ProviderFailure::new(message, None, None) }
async fn saved_token(reader: fn(ProviderId) -> Result<AccountToken,String>, id: ProviderId) -> Result<AccountToken, String> {
    tauri::async_runtime::spawn_blocking(move || reader(id)).await.map_err(|_| "The saved account token could not be read.".to_string())?
}
async fn save_token(id: ProviderId, token: AccountToken) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || tokens::save(id, &token)).await.map_err(|_| "The account token could not be saved.".to_string())?
}
async fn delete_token(id: ProviderId) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || tokens::forget(id)).await.map_err(|_| "The account token could not be removed.".to_string())?
}
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
                let runner = self.codex_token_runner;
                let result = tauri::async_runtime::spawn_blocking(move || runner(&token)).await
                    .map_err(|_| "The Codex token lookup could not complete.".to_string()).and_then(|v| v)
                    .and_then(|value| super::map::map(id, &codex::normalized(&value)));
                let lifetime = if result.is_ok() { 290 } else { 30 };
                (result, lifetime)
            }
            ProviderId::Claude => (Err("Claude subscription tokens are not supported.".into()), 30),
        }
    }

    pub async fn refresh_token(&self, id: ProviderId, fresh_after: Option<Instant>) -> Result<Snapshot, ProviderFailure> {
        let key = key(id).map_err(failure)?.to_string();
        let gate = self.connection_gate(&key); let _turn = gate.lock().await;
        let token = saved_token(self.manual_credential,id).await.map_err(failure)?;
        let fingerprint = token.fingerprint();
        if self.cooldowns.lock().ok().and_then(|store| store.until(&key, &fingerprint)).is_some() {
            return Err(self.quota_failure("The provider is limiting requests. Wait for the retry time.".into(), &key, fingerprint, id));
        }
        if let Some(saved) = self.manual.lock().await.get(&key).filter(|c| c.fingerprint == fingerprint && c.until > Instant::now() && fresh_after.is_none_or(|asked| c.checked_at >= asked) && c.result.as_ref().map(super::before_reset).unwrap_or(true)) {
            return saved.result.clone().map_err(|message| self.quota_failure(message, &key, fingerprint, id));
        }
        let (result, seconds) = self.token_lookup(id, &token).await;
        if saved_token(self.manual_credential,id).await.map(|current| current.fingerprint() != fingerprint).unwrap_or(true) {
            self.manual.lock().await.remove(&key);
            return Err(failure("The saved account token changed during refresh. Try again.".into()));
        }
        if result.as_ref().err().is_some_and(|e| e.starts_with("The provider is limiting requests.")) {
            if let Ok(mut store) = self.cooldowns.lock() { store.set(key.clone(), &fingerprint, seconds); }
        }
        if let Ok(snapshot) = &result { if let Ok(mut store) = self.snapshots.lock() { store.put(key.clone(), fingerprint, snapshot.clone()); } }
        self.manual.lock().await.insert(key.clone(), Cache { fingerprint, checked_at: Instant::now(), until: Instant::now() + Duration::from_secs(seconds), result: result.clone() });
        result.map_err(|message| self.quota_failure(message, &key, fingerprint, id))
    }

    async fn connect_token(&self, id: ProviderId, token: AccountToken) -> Result<Snapshot, ProviderFailure> {
        let key = key(id).map_err(failure)?.to_string();
        let gate = self.connection_gate(&key); let _turn = gate.lock().await;
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
        save_token(id, token).await.map_err(failure)?;
        if let Ok(mut store) = self.cooldowns.lock() { store.remove(&key); }
        if let Ok(mut store) = self.snapshots.lock() { store.remove(&key); store.put(key.clone(), fingerprint, snapshot.clone()); }
        self.manual.lock().await.insert(key, Cache { fingerprint, checked_at: Instant::now(), until: Instant::now() + Duration::from_secs(seconds), result: Ok(snapshot.clone()) });
        Ok(snapshot)
    }
}

#[tauri::command]
pub async fn unlock_saved_connection(connection_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || tokens::unlock_saved_connection(&connection_id)).await
        .map_err(|_| "Keychain access could not complete. Try again in Connections.".to_string())?
}

#[tauri::command]
pub async fn connect_account_token(service: tauri::State<'_, ProviderService>, provider_id: ProviderId, token: String, account_id: Option<String>) -> Result<Snapshot, ProviderFailure> {
    let token = AccountToken::parse(provider_id, token, account_id).map_err(failure)?;
    service.connect_token(provider_id, token).await
}

#[tauri::command]
pub async fn forget_account_token(service: tauri::State<'_, ProviderService>, provider_id: ProviderId) -> Result<(), String> {
    let key = key(provider_id)?;
    let gate = service.connection_gate(key); let _turn = gate.lock().await;
    delete_token(provider_id).await?;
    service.manual.lock().await.remove(key);
    if let Ok(mut store) = service.snapshots.lock() { store.remove(key); }
    if let Ok(mut store) = service.cooldowns.lock() { store.remove(key); }
    Ok(())
}
