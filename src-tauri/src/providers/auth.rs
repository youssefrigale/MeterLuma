use rusqlite::{Connection, OpenFlags};
use sha2::{Digest, Sha256};
use std::path::Path;

pub struct Credential { pub token: String }

impl Credential {
    pub fn fingerprint(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(self.token.len().to_be_bytes());
        hash.update(self.token.as_bytes());
        hash.finalize().into()
    }
    /// Identifies the account rather than the token, so a provider rotating the token for the same
    /// account keeps its rate-limit deadline and cached reading. Opaque tokens fall back to the token.
    pub fn account(&self) -> [u8; 32] {
        jwt_subject(&self.token).map_or_else(|| self.fingerprint(), |subject| identity("jwt-subject", &subject))
    }
}

/// A one-way identifier for an account, built from a provider-assigned account id.
pub fn identity(kind: &str, account: &str) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(kind.as_bytes());
    hash.update([0]);
    hash.update(account.as_bytes());
    hash.finalize().into()
}

/// The `sub` claim of a JWT, read without verification: it only tells local sign-ins apart.
pub fn jwt_subject(token: &str) -> Option<String> {
    use base64::Engine;
    let mut parts = token.split('.');
    let (_, payload, _) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || payload.len() > 16_384 { return None; }
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    claims["sub"].as_str().filter(|subject| !subject.is_empty() && subject.len() <= 512).map(str::to_string)
}

#[cfg(target_os = "macos")]
pub(super) fn keychain(service: &str) -> Result<String, String> {
    use std::{io::Read, process::{Command, Stdio}, time::Duration};
    use wait_timeout::ChildExt;
    let child = Command::new("/usr/bin/security")
        .args(["find-generic-password", "-s", service, "-w"])
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
        .map_err(|_| "macOS Keychain could not be accessed.".to_string())?;
    struct KeychainProcess(std::process::Child);
    impl Drop for KeychainProcess { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }
    let mut child = KeychainProcess(child);
    let stdout = child.0.stdout.take().ok_or("Keychain returned no result.")?;
    let reader = std::thread::spawn(move || {
        let mut output = String::new();
        stdout.take(65_537).read_to_string(&mut output).map(|_| output)
    });
    let status = child.0.wait_timeout(Duration::from_secs(15))
        .map_err(|_| "macOS Keychain lookup failed.".to_string())?;
    let Some(status) = status else {
        return Err("Keychain access timed out. Allow access when macOS asks, then try again.".into());
    };
    if !status.success() { return Err("No accessible Keychain sign-in was found. Sign in to the provider app first.".into()); }
    let output = reader.join().map_err(|_| "Keychain sign-in could not be read.".to_string())?
        .map_err(|_| "Keychain sign-in could not be read.".to_string())?;
    if output.len() > 65_536 { return Err("Keychain returned an unsupported sign-in.".into()); }
    Ok(output.trim().to_string())
}

// Reads Cursor's own desktop sign-in, read-only.
pub fn cursor(root: &Path, default_profile: bool) -> Result<Credential, String> {
    let path = root.join("User/globalStorage/state.vscdb");
    if path.exists() {
        let db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|_| "Cursor's local sign-in could not be opened. Close and reopen Cursor, then try again.".to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(2)).map_err(|_| "Cursor's sign-in database is unavailable.")?;
        let raw: Result<String, _> = db.query_row("SELECT substr(value, 1, 65537) FROM ItemTable WHERE key = 'cursorAuth/accessToken'", [], |row| row.get(0));
        if let Ok(raw) = raw {
            let parsed = serde_json::from_str::<String>(&raw).unwrap_or(raw);
            if !parsed.trim().is_empty() && parsed.len() < 65_536 { return super::cursor_storage::token(&parsed).map(|token| Credential { token }); }
        }
    }
    #[cfg(target_os = "macos")]
    {
        let access = if default_profile { keychain("cursor-access-token")? } else { String::new() };
        if !access.is_empty() { return super::cursor_storage::token(&access).map(|token| Credential { token }); }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = default_profile;
    Err("Sign in to Cursor on this device, then try again.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_rotated_jwt_for_the_same_account_keeps_its_identity() {
        use base64::Engine;
        let jwt = |claims: &str| format!("e30.{}.signature", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims));
        let first = Credential { token: jwt(r#"{"sub":"auth0|user_1","exp":1}"#) };
        let rotated = Credential { token: jwt(r#"{"sub":"auth0|user_1","exp":2}"#) };
        let other = Credential { token: jwt(r#"{"sub":"auth0|user_2","exp":2}"#) };
        assert_ne!(first.fingerprint(), rotated.fingerprint());
        assert_eq!(first.account(), rotated.account());
        assert_ne!(first.account(), other.account());
        let opaque = Credential { token: "opaque-token".into() };
        assert_eq!(opaque.account(), opaque.fingerprint());
        assert_eq!(jwt_subject("not.a.jwt.at-all"), None);
    }
    #[test]
    fn fingerprint_changes_when_the_sign_in_changes() {
        assert_ne!(Credential { token: "first-test-token".into() }.fingerprint(), Credential { token: "second-test-token".into() }.fingerprint());
        assert_eq!(Credential { token: "same".into() }.fingerprint(), Credential { token: "same".into() }.fingerprint());
    }
    #[test]
    fn reads_a_synthetic_cursor_profile_without_leaking_its_token() {
        let root = std::env::temp_dir().join(format!("meterluma-cursor-auth-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
        let _cleanup = Cleanup(root.clone());
        let missing = cursor(&root, false).err().unwrap();
        assert!(missing.contains("Sign in to Cursor"));
        let folder = root.join("User/globalStorage");
        std::fs::create_dir_all(&folder).unwrap();
        let db = Connection::open(folder.join("state.vscdb")).unwrap();
        db.execute_batch("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB); INSERT INTO ItemTable VALUES ('cursorAuth/accessToken', '\"fake-cursor-token\"');").unwrap();
        drop(db);
        assert_eq!(cursor(&root, false).unwrap().token, "fake-cursor-token");
        let db = Connection::open(folder.join("state.vscdb")).unwrap();
        db.execute_batch("INSERT INTO ItemTable VALUES ('cursorAuth/accessToken', '  ');").unwrap();
        drop(db);
        assert!(!cursor(&root, false).err().unwrap().contains("fake-cursor-token"));
    }
}
