use super::ProviderId;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, io::Read, path::PathBuf};

pub struct Credential {
    pub token: String,
    pub account_id: Option<String>,
    pub file: Option<PathBuf>,
}

impl Credential {
    pub fn fingerprint(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(self.token.len().to_be_bytes());
        hash.update(self.token.as_bytes());
        if let Some(account) = &self.account_id { hash.update(account.as_bytes()); }
        hash.finalize().into()
    }
}

pub(super) fn read_json(path: &PathBuf) -> Result<Value, String> {
    let metadata = fs::metadata(path).map_err(|_| "No readable local sign-in was found. Sign in to the provider app first.".to_string())?;
    if metadata.len() > 1_048_576 { return Err("The local sign-in file is unexpectedly large.".into()); }
    let file = fs::File::open(path).map_err(|_| "Your local sign-in could not be read.".to_string())?;
    let mut bytes = Vec::new();
    file.take(1_048_577).read_to_end(&mut bytes).map_err(|_| "Your local sign-in could not be read.".to_string())?;
    if bytes.len() > 1_048_576 { return Err("The local sign-in file is unexpectedly large.".into()); }
    serde_json::from_slice(&bytes).map_err(|_| "Your local sign-in format is not supported. Sign in again using the provider app.".into())
}

fn token(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty() && value.len() < 65_536).map(str::to_owned)
}

pub fn from_auth_json(id: ProviderId, value: &Value) -> Result<Credential, String> {
    let (access, account_id) = match id {
        ProviderId::Claude => (token(value.pointer("/claudeAiOauth/accessToken")), None),
        ProviderId::Codex => return Err("Codex authentication is managed by the official CLI.".into()),
        ProviderId::Cursor => return Err("Cursor uses its desktop sign-in database.".into()),
    };
    access.map(|token| Credential { token, account_id, file: None }).ok_or_else(|| "A subscription sign-in is required. API keys cannot read these plan limits.".into())
}

#[cfg(target_os = "macos")]
fn keychain(service: &str) -> Result<String, String> {
    use std::{io::Read, process::{Command, Stdio}, time::Duration};
    use wait_timeout::ChildExt;
    let mut child = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", service, "-w"])
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
        .map_err(|_| "macOS Keychain could not be accessed.".to_string())?;
    let stdout = child.stdout.take().ok_or("Keychain returned no result.")?;
    let reader = std::thread::spawn(move || {
        let mut output = String::new();
        stdout.take(65_537).read_to_string(&mut output).map(|_| output)
    });
    let status = child.wait_timeout(Duration::from_secs(15))
        .map_err(|_| "macOS Keychain lookup failed.".to_string())?;
    let Some(status) = status else {
        let _ = child.kill(); let _ = child.wait();
        return Err("Keychain access timed out. Allow access when macOS asks, then try again.".into());
    };
    if !status.success() { return Err("No accessible Keychain sign-in was found. Sign in to the provider app first.".into()); }
    let output = reader.join().map_err(|_| "Keychain sign-in could not be read.".to_string())?
        .map_err(|_| "Keychain sign-in could not be read.".to_string())?;
    if output.len() > 65_536 { return Err("Keychain returned an unsupported sign-in.".into()); }
    Ok(output.trim().to_string())
}

pub fn load(id: ProviderId, directory: Option<&str>) -> Result<Credential, String> {
    match id {
        ProviderId::Claude => {
            let custom_root = directory.is_some() || std::env::var_os("CLAUDE_CONFIG_DIR").is_some();
            let root = crate::profiles::root(id, directory)?;
            #[cfg(target_os = "macos")]
            if !custom_root {
                if let Ok(secret) = keychain("Claude Code-credentials") {
                    if let Ok(value) = serde_json::from_str::<Value>(&secret) {
                        if let Ok(credential) = from_auth_json(id, &value) { return Ok(credential); }
                    }
                }
            }
            let path = root.join(".credentials.json");
            if path.exists() { let mut credential = from_auth_json(id, &read_json(&path)?)?; credential.file = Some(path); return Ok(credential); }
            if custom_root { return Err("No readable Claude sign-in was found in the selected profile directory.".into()); }
            #[cfg(target_os = "macos")]
            return Err("Sign in to Claude Code on this device, then try again.".into());
            #[cfg(not(target_os = "macos"))]
            Err("Sign in to Claude Code on this device, then try again.".into())
        }
        ProviderId::Codex => Err("Codex authentication is managed by the official CLI.".into()),
        ProviderId::Cursor => {
            let root = crate::profiles::root(id, directory)?;
            let path = root.join("User/globalStorage/state.vscdb");
            if path.exists() {
                let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .map_err(|_| "Cursor's local sign-in could not be opened. Close and reopen Cursor, then try again.".to_string())?;
                db.busy_timeout(std::time::Duration::from_secs(2)).map_err(|_| "Cursor's sign-in database is unavailable.")?;
                let raw: Result<String, _> = db.query_row("SELECT substr(value, 1, 65537) FROM ItemTable WHERE key = 'cursorAuth/accessToken'", [], |row| row.get(0));
                if let Ok(raw) = raw {
                    let parsed = serde_json::from_str::<String>(&raw).unwrap_or(raw);
                    if !parsed.trim().is_empty() && parsed.len() < 65_536 {
                        return Ok(Credential { token: parsed.trim().to_string(), account_id: None, file: None });
                    }
                }
            }
            #[cfg(target_os = "macos")]
            {
                let access = if directory.is_none() { keychain("cursor-access-token")? } else { String::new() };
                if !access.is_empty() { return Ok(Credential { token: access, account_id: None, file: None }); }
            }
            Err("Sign in to Cursor on this device, then try again.".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn rejects_api_key_only_codex_accounts() {
        assert!(from_auth_json(ProviderId::Codex, &json!({"OPENAI_API_KEY": "sample"})).is_err());
    }
    #[test]
    fn reads_claude_without_leaking_tokens_and_delegates_codex_authentication() {
        let auth = from_auth_json(ProviderId::Claude, &json!({"claudeAiOauth": {"accessToken": "test-only-token"}})).unwrap();
        assert_eq!(auth.token, "test-only-token");
        let error = from_auth_json(ProviderId::Codex, &json!({"secret": "test-only-token"})).err().unwrap();
        assert!(!error.contains("test-only-token"));
    }
    #[test]
    fn fingerprint_changes_when_the_account_changes() {
        let first = Credential { token: "test-token".into(), account_id: Some("first".into()), file: None };
        let second = Credential { token: "test-token".into(), account_id: Some("second".into()), file: None };
        assert_ne!(first.fingerprint(), second.fingerprint());
    }
}
