//! User-supplied tokens. No provider profile or sign-in files are read here.
use super::ProviderId;
use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
#[cfg(not(target_os = "macos"))]
use std::{io::Read, path::{Path, PathBuf}};

#[derive(Clone, Deserialize, Serialize)]
pub struct AccountToken {
    pub access_token: String,
    pub account_id: Option<String>,
}

impl AccountToken {
    pub fn parse(id: ProviderId, raw: String, account_id: Option<String>) -> Result<Self, String> {
        if matches!(id, ProviderId::Claude) { return Err("Claude subscription tokens are not supported. Use its optional local history connection.".into()); }
        let token = raw.trim().strip_prefix("Bearer ").unwrap_or(raw.trim()).trim();
        if token.is_empty() || token.len() > 16_384 || token.chars().any(char::is_whitespace) || token.chars().any(char::is_control) {
            return Err("Enter a valid account access token without spaces or line breaks.".into());
        }
        if token.starts_with("sk-") { return Err("Enter an account access token, not an API key.".into()); }
        let account_id = account_id.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
        let account_id = if matches!(id, ProviderId::Codex) {
            account_id.or_else(|| {
                let payload = token.split('.').nth(1)?;
                let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload.trim_end_matches('=')).ok()?;
                let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
                // This is only a routing hint; the provider validates the token.
                value.pointer("/https:~1~1api.openai.com~1auth/chatgpt_account_id")?.as_str().map(str::to_string)
            }).ok_or("This Codex token needs a ChatGPT account ID. Enter the account ID with its OAuth access token.")?.into()
        } else { None };
        if account_id.as_ref().is_some_and(|id| id.len() > 256 || !id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))) {
            return Err("The ChatGPT account ID is not valid.".into());
        }
        Ok(Self { access_token: token.to_string(), account_id })
    }
    pub fn fingerprint(&self) -> [u8; 32] {
        let mut hash = Sha256::new();
        hash.update(self.access_token.len().to_be_bytes());
        hash.update(self.access_token.as_bytes());
        hash.update(self.account_id.as_deref().unwrap_or("").as_bytes());
        hash.finalize().into()
    }
}

#[derive(Deserialize, Serialize)]
struct StoredToken { provider: String, credential: AccountToken }

fn name(id: ProviderId) -> Result<&'static str, String> {
    match id { ProviderId::Codex => Ok("codex"), ProviderId::Cursor => Ok("cursor"), ProviderId::Claude => Err("Claude subscription tokens are not supported.".into()) }
}

#[cfg(not(target_os = "macos"))]
fn path(id: ProviderId) -> Result<PathBuf, String> {
    Ok(dirs::data_local_dir().ok_or("Secure token storage is unavailable.")?.join("app.meterluma.desktop").join("account-tokens-v1").join(format!("{}.bin", name(id)?)))
}

pub fn load(id: ProviderId) -> Result<AccountToken, String> {
    #[cfg(target_os = "macos")]
    let bytes = macos::read(name(id)?)?;
    #[cfg(not(target_os = "macos"))]
    let bytes = read_file(&path(id)?)?;
    decode(id, &bytes)
}

fn decode(id: ProviderId, bytes: &[u8]) -> Result<AccountToken, String> {
    let stored: StoredToken = serde_json::from_slice(bytes).map_err(|_| "Saved token could not be opened. Replace it in Connections.".to_string())?;
    if stored.provider != name(id)? { return Err("Saved token belongs to another provider. Reconnect in Connections.".into()); }
    AccountToken::parse(id, stored.credential.access_token, stored.credential.account_id)
}

pub fn save(id: ProviderId, token: &AccountToken) -> Result<(), String> {
    let bytes = serde_json::to_vec(&StoredToken { provider: name(id)?.into(), credential: token.clone() }).map_err(|_| "Account token could not be secured.")?;
    #[cfg(target_os = "macos")]
    { macos::write(name(id)?, &bytes) }
    #[cfg(not(target_os = "macos"))]
    { write_file(&path(id)?, &bytes) }
}

pub fn forget(id: ProviderId) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    { macos::forget(name(id)?) }
    #[cfg(not(target_os = "macos"))]
    { forget_file(&path(id)?) }
}

#[cfg(not(target_os = "macos"))]
fn read_file(path: &Path) -> Result<Vec<u8>, String> {
    let mut data = Vec::new();
    std::fs::File::open(path).map_err(|_| "No saved account token. Add one in Connections.")?.take(65_537).read_to_end(&mut data).map_err(|_| "Saved token could not be read.")?;
    if data.len() > 65_536 { return Err("Saved token is invalid. Replace it in Connections.".into()); }
    unprotect(&data)
}
#[cfg(not(target_os = "macos"))]
fn write_file(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let encrypted = protect(bytes)?;
    std::fs::create_dir_all(target.parent().ok_or("Secure token storage is unavailable.")?).map_err(|_| "Secure token storage could not be created.")?;
    let temporary = target.with_extension("tmp");
    if std::fs::write(&temporary, encrypted).and_then(|_| std::fs::rename(&temporary, target)).is_err() {
        let _ = std::fs::remove_file(temporary);
        return Err("The encrypted token could not be saved.".into());
    }
    Ok(())
}
#[cfg(not(target_os = "macos"))]
fn forget_file(target: &Path) -> Result<(), String> {
    for path in [target.to_path_buf(), target.with_extension("tmp")] {
        match std::fs::remove_file(path) { Ok(()) => {}, Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}, Err(_) => return Err("The saved token could not be removed.".into()) }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn crypt(data: &[u8], encrypt: bool) -> Result<Vec<u8>, String> {
    use std::ffi::c_void;
    #[repr(C)] struct Blob { len: u32, data: *mut u8 }
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(input: *const Blob, description: *const u16, entropy: *const Blob, reserved: *const c_void, prompt: *const c_void, flags: u32, output: *mut Blob) -> i32;
        fn CryptUnprotectData(input: *const Blob, description: *mut *mut u16, entropy: *const Blob, reserved: *const c_void, prompt: *const c_void, flags: u32, output: *mut Blob) -> i32;
    }
    #[link(name = "kernel32")] extern "system" { fn LocalFree(data: *mut c_void) -> *mut c_void; }
    let input = Blob { len: u32::try_from(data.len()).map_err(|_| "Token is too large.")?, data: data.as_ptr() as *mut u8 };
    let mut output = Blob { len: 0, data: std::ptr::null_mut() };
    // User-bound DPAPI, no machine-wide flag, and no unattended OS prompt.
    unsafe {
        let result = if encrypt { CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 1, &mut output) }
            else { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 1, &mut output) };
        if result == 0 { return Err("Windows could not secure or unlock the account token. Reconnect in Connections.".into()); }
        let bytes = std::slice::from_raw_parts(output.data, output.len as usize).to_vec();
        LocalFree(output.data.cast());
        Ok(bytes)
    }
}
#[cfg(target_os = "windows")] fn protect(data: &[u8]) -> Result<Vec<u8>, String> { crypt(data, true) }
#[cfg(target_os = "windows")] fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> { crypt(data, false) }
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn protect(_: &[u8]) -> Result<Vec<u8>, String> { Err("Secure account tokens are supported on Windows and macOS.".into()) }
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
fn unprotect(_: &[u8]) -> Result<Vec<u8>, String> { Err("Secure account tokens are supported on Windows and macOS.".into()) }

#[cfg(target_os = "macos")]
mod macos {
    use std::ffi::c_void;
    const SERVICE: &[u8] = b"app.meterluma.desktop.account-tokens-v1";
    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainFindGenericPassword(keychain: *const c_void, service_len: u32, service: *const u8, account_len: u32, account: *const u8, len: *mut u32, data: *mut *mut c_void, item: *mut *mut c_void) -> i32;
        fn SecKeychainAddGenericPassword(keychain: *const c_void, service_len: u32, service: *const u8, account_len: u32, account: *const u8, len: u32, data: *const c_void, item: *mut *mut c_void) -> i32;
        fn SecKeychainItemModifyAttributesAndData(item: *const c_void, attributes: *const c_void, len: u32, data: *const c_void) -> i32;
        fn SecKeychainItemFreeContent(attributes: *const c_void, data: *mut c_void) -> i32;
        fn SecKeychainItemDelete(item: *const c_void) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")] extern "C" { fn CFRelease(value: *const c_void); }
    fn find(account: &str, length: *mut u32, data: *mut *mut c_void, item: *mut *mut c_void) -> i32 {
        unsafe { SecKeychainFindGenericPassword(std::ptr::null(), SERVICE.len() as u32, SERVICE.as_ptr(), account.len() as u32, account.as_ptr(), length, data, item) }
    }
    pub fn read(account: &str) -> Result<Vec<u8>, String> {
        let mut len = 0; let mut data = std::ptr::null_mut();
        if find(account, &mut len, &mut data, std::ptr::null_mut()) != 0 { return Err("No accessible saved token. Reconnect in Connections and allow Keychain access if asked.".into()); }
        unsafe { let result = if len <= 65_536 { Ok(std::slice::from_raw_parts(data.cast::<u8>(), len as usize).to_vec()) } else { Err("The saved token is too large.".into()) }; SecKeychainItemFreeContent(std::ptr::null(), data); result }
    }
    pub fn write(account: &str, bytes: &[u8]) -> Result<(), String> {
        let mut item = std::ptr::null_mut();
        let found = find(account, std::ptr::null_mut(), std::ptr::null_mut(), &mut item);
        let status = unsafe { if found == 0 { let status = SecKeychainItemModifyAttributesAndData(item, std::ptr::null(), bytes.len() as u32, bytes.as_ptr().cast()); CFRelease(item); status }
            else if found == -25300 { SecKeychainAddGenericPassword(std::ptr::null(), SERVICE.len() as u32, SERVICE.as_ptr(), account.len() as u32, account.as_ptr(), bytes.len() as u32, bytes.as_ptr().cast(), std::ptr::null_mut()) }
            else { found } };
        if status == 0 { Ok(()) } else { Err("Keychain could not save the token. Allow access if asked, then try again.".into()) }
    }
    pub fn forget(account: &str) -> Result<(), String> {
        let mut item = std::ptr::null_mut(); let found = find(account, std::ptr::null_mut(), std::ptr::null_mut(), &mut item);
        if found == -25300 { return Ok(()); }
        if found != 0 { return Err("Keychain could not remove the token. Allow access if asked, then try again.".into()); }
        let status = unsafe { let status = SecKeychainItemDelete(item); CFRelease(item); status };
        if status == 0 { Ok(()) } else { Err("The saved token could not be removed from Keychain.".into()) }
    }
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn supplied_tokens_are_bounded_and_do_not_accept_api_keys_or_claude_credentials() {
        for token in ["", "bad\nheader", "bad header", "sk-api-key"] { assert!(AccountToken::parse(ProviderId::Cursor, token.into(), None).is_err()); }
        assert!(AccountToken::parse(ProviderId::Cursor, "x".repeat(16_385), None).is_err());
        assert!(AccountToken::parse(ProviderId::Claude, "not-a-real-token".into(), None).is_err());
        assert!(AccountToken::parse(ProviderId::Codex, "not-a-real-token".into(), Some("bad\r\nid".into())).is_err());
        let token = AccountToken::parse(ProviderId::Cursor, " Bearer fixture-token ".into(), None).unwrap();
        assert_eq!(token.access_token, "fixture-token");
    }
    #[test] fn codex_account_routing_is_extracted_without_trusting_it_as_authentication() {
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(br#"{"https://api.openai.com/auth":{"chatgpt_account_id":"fixture-account"}}"#);
        let token = AccountToken::parse(ProviderId::Codex, format!("header.{payload}.signature"), None).unwrap();
        assert_eq!(token.account_id.as_deref(), Some("fixture-account"));
        let changed = AccountToken { account_id: Some("other-account".into()), ..token.clone() };
        assert_ne!(token.fingerprint(), changed.fingerprint());
        assert!(AccountToken::parse(ProviderId::Codex, "missing-claim".into(), None).is_err());
    }
    #[cfg(target_os = "windows")]
    #[test] fn protected_files_support_replacement_and_forgetting_without_cross_provider_use() {
        let root = std::env::temp_dir().join(format!("meterluma-vault-test-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        let target = root.join("cursor.bin");
        let stored = StoredToken { provider: "cursor".into(), credential: AccountToken { access_token: "synthetic-file-token".into(), account_id: None } };
        let bytes = serde_json::to_vec(&stored).unwrap();
        write_file(&target, &bytes).unwrap();
        let disk = std::fs::read(&target).unwrap();
        assert!(!disk.windows(stored.credential.access_token.len()).any(|w| w == stored.credential.access_token.as_bytes()));
        let unlocked = read_file(&target).unwrap();
        assert_eq!(decode(ProviderId::Cursor, &unlocked).unwrap().access_token, "synthetic-file-token");
        assert!(decode(ProviderId::Codex, &unlocked).is_err());
        let newer = StoredToken { credential: AccountToken { access_token: "synthetic-replacement-token".into(), account_id: None }, ..stored };
        write_file(&target, &serde_json::to_vec(&newer).unwrap()).unwrap();
        assert_eq!(decode(ProviderId::Cursor, &read_file(&target).unwrap()).unwrap().access_token, "synthetic-replacement-token");
        std::fs::write(target.with_extension("tmp"), disk).unwrap();
        forget_file(&target).unwrap();
        assert!(!target.exists()); assert!(!target.with_extension("tmp").exists());
        assert!(read_file(&target).is_err()); forget_file(&target).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[cfg(target_os = "windows")]
    #[test] fn windows_encrypts_tokens_and_rejects_damaged_ciphertext() {
        let plain = b"synthetic-test-token-only";
        let encrypted = protect(plain).unwrap();
        assert!(!encrypted.windows(plain.len()).any(|w| w == plain));
        assert_eq!(unprotect(&encrypted).unwrap(), plain);
        let mut damaged = encrypted; let index = damaged.len() / 2; damaged[index] ^= 0xff;
        assert!(unprotect(&damaged).is_err());
    }
}
