use super::ProviderId;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, path::PathBuf};

pub struct Credential {
    pub token: String,
    pub account_id: Option<String>,
}

impl Credential {
    pub fn fingerprint(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(&self.token);
        if let Some(account) = &self.account_id { hash.update(account); }
        hash.finalize().into()
    }
}

fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Your home directory could not be found.".into())
}

fn read_json(path: &PathBuf) -> Result<Value, String> {
    let metadata = fs::metadata(path).map_err(|_| "No readable local sign-in was found. Sign in to the provider app first.".to_string())?;
    if metadata.len() > 1_048_576 { return Err("The local sign-in file is unexpectedly large.".into()); }
    let bytes = fs::read(path).map_err(|_| "Your local sign-in could not be read.".to_string())?;
    serde_json::from_slice(&bytes).map_err(|_| "Your local sign-in format is not supported. Sign in again using the provider app.".into())
}

fn token(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty() && value.len() < 65_536).map(str::to_owned)
}

pub fn from_auth_json(id: ProviderId, value: &Value) -> Result<Credential, String> {
    let (access, account_id) = match id {
        ProviderId::Claude => (token(value.pointer("/claudeAiOauth/accessToken")), None),
        ProviderId::Codex => (token(value.pointer("/tokens/access_token")), token(value.pointer("/tokens/account_id"))),
        ProviderId::Cursor => return Err("Cursor uses its desktop sign-in database.".into()),
    };
    access.map(|token| Credential { token, account_id }).ok_or_else(|| "A subscription sign-in is required. API keys cannot read these plan limits.".into())
}

#[cfg(target_os = "macos")]
fn keychain(service: &str) -> Result<String, String> {
    use std::{io::Read, process::{Command, Stdio}, time::Duration};
    use wait_timeout::ChildExt;
    let mut child = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", service, "-w"])
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
        .map_err(|_| "macOS Keychain could not be accessed.".to_string())?;
    let status = child.wait_timeout(Duration::from_secs(15))
        .map_err(|_| "macOS Keychain lookup failed.".to_string())?;
    let Some(status) = status else {
        let _ = child.kill(); let _ = child.wait();
        return Err("Keychain access timed out. Allow access when macOS asks, then try again.".into());
    };
    if !status.success() { return Err("No accessible Keychain sign-in was found. Sign in to the provider app first.".into()); }
    let mut output = String::new();
    child.stdout.take().ok_or("Keychain returned no result.")?
        .take(65_537).read_to_string(&mut output)
        .map_err(|_| "Keychain sign-in could not be read.".to_string())?;
    if output.len() > 65_536 { return Err("Keychain returned an unsupported sign-in.".into()); }
    Ok(output.trim().to_string())
}

pub fn load(id: ProviderId) -> Result<Credential, String> {
    match id {
        ProviderId::Claude => {
            let root = std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from).unwrap_or(home()?.join(".claude"));
            let path = root.join(".credentials.json");
            if path.exists() { return from_auth_json(id, &read_json(&path)?); }
            #[cfg(target_os = "macos")]
            {
                let secret = keychain("Claude Code-credentials")?;
                let value: Value = serde_json::from_str(&secret).map_err(|_| "Claude's Keychain sign-in is not supported.".to_string())?;
                return from_auth_json(id, &value);
            }
            #[cfg(not(target_os = "macos"))]
            Err("Sign in to Claude Code on this device, then try again.".into())
        }
        ProviderId::Codex => {
            let root = std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or(home()?.join(".codex"));
            from_auth_json(id, &read_json(&root.join("auth.json"))?)
        }
        ProviderId::Cursor => {
            #[cfg(target_os = "macos")]
            let root = home()?.join("Library/Application Support");
            #[cfg(target_os = "windows")]
            let root = std::env::var_os("APPDATA").map(PathBuf::from).ok_or("Windows app data could not be found.")?;
            #[cfg(not(any(target_os = "windows", target_os = "macos")))]
            let root = dirs::config_dir().ok_or("App data could not be found.")?;
            let path = root.join("Cursor/User/globalStorage/state.vscdb");
            if path.exists() {
                let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .map_err(|_| "Cursor's local sign-in could not be opened. Close and reopen Cursor, then try again.".to_string())?;
                db.busy_timeout(std::time::Duration::from_secs(2)).map_err(|_| "Cursor's sign-in database is unavailable.")?;
                let raw: Result<String, _> = db.query_row("SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken'", [], |row| row.get(0));
                if let Ok(raw) = raw {
                    let parsed = serde_json::from_str::<String>(&raw).unwrap_or(raw);
                    if !parsed.trim().is_empty() && parsed.len() < 65_536 {
                        return Ok(Credential { token: parsed.trim().to_string(), account_id: None });
                    }
                }
            }
            #[cfg(target_os = "macos")]
            {
                let access = keychain("cursor-access-token")?;
                if !access.is_empty() { return Ok(Credential { token: access, account_id: None }); }
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
    fn reads_claude_and_codex_without_leaking_tokens_in_errors() {
        let auth = from_auth_json(ProviderId::Claude, &json!({"claudeAiOauth": {"accessToken": "test-only-token"}})).unwrap();
        assert_eq!(auth.token, "test-only-token");
        let error = from_auth_json(ProviderId::Codex, &json!({"secret": "test-only-token"})).err().unwrap();
        assert!(!error.contains("test-only-token"));
    }
    #[test]
    fn fingerprint_changes_when_the_account_changes() {
        let first = Credential { token: "test-token".into(), account_id: Some("first".into()) };
        let second = Credential { token: "test-token".into(), account_id: Some("second".into()) };
        assert_ne!(first.fingerprint(), second.fingerprint());
    }
}
