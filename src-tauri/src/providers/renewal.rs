use super::{auth, ProviderId};
use serde_json::{json, Value};
use std::{io::Write, path::{Path, PathBuf}};

const REFRESH_URL: &str = "https://platform.claude.com/v1/oauth/token";
const CLIENT_ID: &str = "9d1c250a-e61b-44d9-88ed-5944d1962f5e";

pub struct Failure { pub message: String, pub retry_after: Option<u64> }
fn failure(message: &str) -> Failure { Failure { message: message.into(), retry_after: None } }

fn same_grant(current: &Value, expected: &Value) -> bool {
    ["accessToken", "refreshToken"].iter().all(|key| current.pointer(&format!("/claudeAiOauth/{key}")) == expected.pointer(&format!("/claudeAiOauth/{key}")))
}

fn merge(current: &Value, expected: &Value, rotated: &Value, now: i64) -> Result<Value, Failure> {
    if !same_grant(current, expected) { return Err(failure("Your Claude sign-in changed during renewal. Refresh again.")); }
    let access = rotated["access_token"].as_str().filter(|text| !text.trim().is_empty() && text.len() < 65_536).ok_or_else(|| failure("Claude returned an unsupported token renewal response."))?;
    let seconds = rotated["expires_in"].as_i64().filter(|seconds| (1..=31_536_000).contains(seconds)).ok_or_else(|| failure("Claude returned an unsupported token expiry."))?;
    let mut updated = current.clone();
    let oauth = updated["claudeAiOauth"].as_object_mut().ok_or_else(|| failure("Your Claude credential document changed."))?;
    oauth.insert("accessToken".into(), json!(access));
    if let Some(refresh) = rotated["refresh_token"].as_str().filter(|text| !text.trim().is_empty() && text.len() < 65_536) { oauth.insert("refreshToken".into(), json!(refresh)); }
    oauth.insert("expiresAt".into(), json!(now + seconds * 1000));
    Ok(updated)
}

fn replace_file(path: &Path, temporary: &Path) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" { fn ReplaceFileW(replaced: *const u16, replacement: *const u16, backup: *const u16, flags: u32, exclude: *mut std::ffi::c_void, reserved: *mut std::ffi::c_void) -> i32; }
        let replaced: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let replacement: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        // ReplaceFile preserves the original credential file's ACL and replaces atomically.
        if unsafe { ReplaceFileW(replaced.as_ptr(), replacement.as_ptr(), std::ptr::null(), 0, std::ptr::null_mut(), std::ptr::null_mut()) } == 0 { return Err(std::io::Error::last_os_error()); }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    { std::fs::rename(temporary, path) }
}

fn save(path: &PathBuf, expected: &Value, rotated: &Value) -> Result<auth::Credential, Failure> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| failure("Claude sign-in could not be checked before saving."))?;
    if metadata.file_type().is_symlink() { return Err(failure("Renew a linked Claude credential file using Claude Code.")); }
    let current = auth::read_json(path).map_err(|_| failure("Claude sign-in could not be read before saving."))?;
    let updated = merge(&current, expected, rotated, chrono::Utc::now().timestamp_millis())?;
    let bytes = serde_json::to_vec(&updated).map_err(|_| failure("Claude token renewal could not be saved."))?;
    let temporary = path.with_file_name(format!(".meterluma-oauth-{}-{}.tmp", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
    struct Cleanup(PathBuf);
    impl Drop for Cleanup { fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); } }
    let _cleanup = Cleanup(temporary.clone());
    let mut options = std::fs::OpenOptions::new(); options.write(true).create_new(true);
    #[cfg(unix)] { use std::os::unix::fs::OpenOptionsExt; options.mode(0o600); }
    let mut file = options.open(&temporary).map_err(|_| failure("Claude token renewal could not be saved."))?;
    file.write_all(&bytes).and_then(|_| file.sync_all()).map_err(|_| failure("Claude token renewal could not be saved."))?;
    drop(file);
    // Best-effort generation checks, as in OpenUsage: the provider-owned store has
    // no atomic compare-and-swap. Never overwrite a changed login or unrelated fields.
    let latest = auth::read_json(path).map_err(|_| failure("Claude sign-in changed while saving."))?;
    if latest != current { return Err(failure("Your Claude sign-in changed during renewal. Refresh again.")); }
    replace_file(path, &temporary).map_err(|_| failure("Claude token renewal could not replace the credential file."))?;
    let mut credential = auth::from_auth_json(ProviderId::Claude, &updated).map_err(|_| failure("The renewed Claude sign-in could not be read."))?;
    credential.file = Some(path.clone());
    Ok(credential)
}

pub async fn renew(client: &reqwest::Client, expected: &auth::Credential, directory: Option<&str>, force: bool) -> Result<Option<auth::Credential>, Failure> {
    renew_at(client, expected, directory, force, REFRESH_URL).await
}

async fn renew_at(client: &reqwest::Client, expected: &auth::Credential, directory: Option<&str>, force: bool, endpoint: &str) -> Result<Option<auth::Credential>, Failure> {
    // Only the selected Claude Code credential file is writable. Keychain/Desktop
    // credentials remain read-only until their native stores are validated on Mac.
    let Some(path) = expected.file.clone() else { return Ok(None); };
    let document = auth::read_json(&path).map_err(|_| failure("The selected Claude sign-in could not be read."))?;
    let credential = auth::from_auth_json(ProviderId::Claude, &document).map_err(|_| failure("Claude subscription sign-in is required."))?;
    if credential.fingerprint() != expected.fingerprint() { return Err(failure("Your Claude sign-in changed. Refresh again.")); }
    let near_expiry = document.pointer("/claudeAiOauth/expiresAt").and_then(Value::as_i64).is_some_and(|expires| expires <= chrono::Utc::now().timestamp_millis() + 300_000);
    if !force && !near_expiry { return Ok(None); }
    let Some(refresh) = document.pointer("/claudeAiOauth/refreshToken").and_then(Value::as_str).filter(|text| !text.trim().is_empty() && text.len() < 65_536) else { return Ok(None); };
    let mut body = json!({"grant_type":"refresh_token", "refresh_token":refresh, "client_id":CLIENT_ID});
    if let Some(scopes) = document.pointer("/claudeAiOauth/scopes").and_then(Value::as_array) {
        let scopes: Vec<&str> = scopes.iter().filter_map(Value::as_str).filter(|scope| scope.len() < 100 && !scope.contains(char::is_whitespace)).collect();
        if !scopes.is_empty() { body["scope"] = json!(scopes.join(" ")); }
    }
    let mut response = client.post(endpoint).json(&body).send().await.map_err(|_| failure("Claude token renewal could not reach the provider."))?;
    if response.status().as_u16() == 429 {
        let seconds = super::cooldowns::retry_seconds(response.headers().get("retry-after").and_then(|value| value.to_str().ok()), chrono::Utc::now().timestamp_millis());
        return Err(Failure { message: format!("The provider is limiting requests. MeterLuma will retry after {seconds} seconds."), retry_after: Some(seconds) });
    }
    let selected = auth::load(ProviderId::Claude, directory).map_err(|_| failure("Your Claude sign-in changed during renewal."))?;
    if selected.fingerprint() != expected.fingerprint() || selected.file.as_ref() != Some(&path) { return Err(failure("Your Claude sign-in changed during renewal. Refresh again.")); }
    if !response.status().is_success() { return Err(failure("Claude could not renew this sign-in. Sign in again using Claude Code.")); }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| failure("Claude token renewal response could not be read."))? {
        if bytes.len() + chunk.len() > 65_536 { return Err(failure("Claude token renewal response was too large.")); }
        bytes.extend_from_slice(&chunk);
    }
    let rotated: Value = serde_json::from_slice(&bytes).map_err(|_| failure("Claude returned an unsupported token renewal response."))?;
    let selected = auth::load(ProviderId::Claude, directory).map_err(|_| failure("Your Claude sign-in changed during renewal."))?;
    if selected.fingerprint() != expected.fingerprint() || selected.file.as_ref() != Some(&path) { return Err(failure("Your Claude sign-in changed during renewal. Refresh again.")); }
    save(&path, &document, &rotated).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    #[test]
    fn expired_file_login_renews_once_without_widening_scopes_or_touching_other_credentials() {
        let root = dirs::home_dir().unwrap().join(format!(".meterluma-renewal-test-{}-{}",std::process::id(),chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        std::fs::create_dir(&root).unwrap(); let path = root.join(".credentials.json");
        struct Cleanup(PathBuf);
        impl Drop for Cleanup { fn drop(&mut self) { let _ = std::fs::remove_file(self.0.join(".credentials.json")); let _ = std::fs::remove_dir(&self.0); } }
        let _cleanup = Cleanup(root.clone());
        let original = json!({"claudeAiOauth":{"accessToken":"fake-old","refreshToken":"fake-refresh","expiresAt":1,"scopes":["user:profile"]},"mcp":{"keep":true}});
        std::fs::write(&path,serde_json::to_vec(&original).unwrap()).unwrap();
        let directory = root.to_string_lossy().to_string();
        let expected = auth::load(ProviderId::Claude, Some(&directory)).unwrap();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); let endpoint = format!("http://{}",listener.local_addr().unwrap());
        let server = std::thread::spawn(move || {
            let (mut socket,_) = listener.accept().unwrap(); socket.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            let mut bytes=Vec::new(); let mut byte=[0;1];
            while !bytes.ends_with(b"\r\n\r\n") { socket.read_exact(&mut byte).unwrap(); bytes.push(byte[0]); }
            let header=String::from_utf8(bytes).unwrap();
            let length: usize=header.lines().find_map(|line|line.to_lowercase().strip_prefix("content-length:").map(|value|value.trim().parse().unwrap())).unwrap();
            let mut bytes=vec![0;length]; socket.read_exact(&mut bytes).unwrap();
            let body:Value=serde_json::from_slice(&bytes).unwrap(); assert_eq!(body["scope"],"user:profile"); assert_eq!(body["grant_type"],"refresh_token");
            let body=r#"{"access_token":"fake-renewed","refresh_token":"fake-rotated","expires_in":3600}"#;
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        });
        let client=reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).build().unwrap();
        let result=tauri::async_runtime::block_on(renew_at(&client,&expected,Some(&directory),false,&endpoint)).unwrap_or_else(|_|panic!("renewal failed")).unwrap();
        server.join().unwrap(); assert_eq!(result.token,"fake-renewed");
        assert_eq!(auth::read_json(&path).unwrap()["mcp"],original["mcp"]);
        assert!(tauri::async_runtime::block_on(renew_at(&client,&result,Some(&directory),false,"http://127.0.0.1:9")).unwrap_or_else(|_|panic!("unnecessary renewal")).is_none());
    }
    #[test]
    fn rotation_preserves_mcp_metadata_and_rejects_replaced_sessions() {
        let original = json!({"claudeAiOauth":{"accessToken":"old","refreshToken":"refresh","subscriptionType":"team","scopes":["user:profile"]},"mcpOAuth":{"server":{"token":"keep"}},"future":{"keep":true}});
        let mut latest = original.clone(); latest["mcpOAuth"]["new"] = json!({"token":"keep-too"});
        let rotated = json!({"access_token":"new","refresh_token":"new-refresh","expires_in":3600});
        let updated = merge(&latest, &original, &rotated, 1000).unwrap_or_else(|_| panic!("merge failed"));
        assert_eq!(updated["mcpOAuth"], latest["mcpOAuth"]);
        assert_eq!(updated["future"], latest["future"]);
        assert_eq!(updated["claudeAiOauth"]["subscriptionType"], "team");
        assert_eq!(updated["claudeAiOauth"]["expiresAt"], 3_601_000);
        latest["claudeAiOauth"]["accessToken"] = json!("different-login");
        assert!(merge(&latest, &original, &rotated, 1000).is_err());
    }
    #[test]
    fn atomic_save_preserves_unknown_fields_and_leaves_no_temporary_credentials() {
        let root = std::env::temp_dir().join(format!("meterluma-renewal-{}-{}",std::process::id(),chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        std::fs::create_dir(&root).unwrap(); let path = root.join("credentials.json");
        let original = json!({"claudeAiOauth":{"accessToken":"fake-old","refreshToken":"fake-refresh"},"mcp":{"preserve":true}});
        std::fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
        let rotated = json!({"access_token":"fake-new","refresh_token":"fake-new-refresh","expires_in":3600});
        let saved = save(&path, &original, &rotated).unwrap_or_else(|_| panic!("save failed"));
        assert_eq!(saved.token, "fake-new");
        assert_eq!(auth::read_json(&path).unwrap()["mcp"], original["mcp"]);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(),1);
        let _ = std::fs::remove_file(path); let _ = std::fs::remove_dir(root);
    }
}
