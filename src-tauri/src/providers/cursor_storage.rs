use base64::Engine;

pub(super) fn token(raw: &str) -> Result<String, String> {
    let raw = raw.trim();
    if let Some(sealed) = raw.strip_prefix("cursor-safe-storage:v1:") {
        let bytes = base64::engine::general_purpose::STANDARD.decode(sealed).map_err(|_| "Cursor's encrypted sign-in is malformed. Sign in again in Cursor.")?;
        #[cfg(target_os = "macos")]
        let clear = decrypt_macos(&bytes, &super::auth::keychain("Cursor Safe Storage")?)?;
        #[cfg(target_os = "windows")]
        let clear = String::from_utf8(super::tokens::unprotect(&bytes)?).map_err(|_| "Cursor's encrypted sign-in is not supported.")?;
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let clear: String = { let _ = bytes; return Err("Connect Cursor with an account access token on this platform.".into()); };
        return plain_token(&clear);
    }
    plain_token(raw)
}

fn plain_token(raw: &str) -> Result<String, String> {
    if raw.is_empty() || raw.len() > 16_384 || raw.starts_with("cursor-safe-storage:") || raw.bytes().any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control()) {
        return Err("Cursor returned an unsupported sign-in. Sign in again in Cursor or connect an account access token.".into());
    }
    Ok(raw.to_string())
}

// Interop with Electron's macOS v10 safeStorage format; never writes Cursor's database or Keychain.
#[cfg(target_os = "macos")]
fn decrypt_macos(sealed: &[u8], password: &str) -> Result<String, String> {
    let cipher = sealed.strip_prefix(b"v10").filter(|bytes| !bytes.is_empty() && bytes.len() <= 65_536 && bytes.len() % 16 == 0)
        .ok_or("Cursor's encrypted sign-in version is not supported.")?;
    let mut key = [0u8; 16];
    let derived = unsafe { CCKeyDerivationPBKDF(2, password.as_ptr().cast(), password.len(), b"saltysalt".as_ptr(), 9, 1, 1003, key.as_mut_ptr(), key.len()) };
    if derived != 0 { return Err("Cursor's sign-in key could not be derived.".into()); }
    let mut clear = vec![0u8; cipher.len() + 16]; let mut written = 0;
    let status = unsafe { CCCrypt(1, 0, 1, key.as_ptr().cast(), key.len(), [b' '; 16].as_ptr().cast(), cipher.as_ptr().cast(), cipher.len(), clear.as_mut_ptr().cast(), clear.len(), &mut written) };
    key.fill(0);
    if status != 0 || written > clear.len() { return Err("Cursor's sign-in could not be unlocked. Allow Keychain access if asked, then try again.".into()); }
    clear.truncate(written);
    String::from_utf8(clear).map_err(|_| "Cursor's decrypted sign-in is not supported.".into())
}

#[cfg(target_os = "macos")]
#[link(name = "System")]
extern "C" {
    fn CCKeyDerivationPBKDF(algorithm: u32, password: *const std::ffi::c_char, password_len: usize, salt: *const u8, salt_len: usize, prf: u32, rounds: u32, key: *mut u8, key_len: usize) -> i32;
    fn CCCrypt(operation: u32, algorithm: u32, options: u32, key: *const std::ffi::c_void, key_len: usize, iv: *const std::ffi::c_void, input: *const std::ffi::c_void, input_len: usize, output: *mut std::ffi::c_void, output_len: usize, written: *mut usize) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn decrypts_electron_v10_fixture_without_treating_ciphertext_as_a_bearer_token() {
        // Independently generated with OpenSSL AES-128-CBC and PBKDF2-SHA1/1003.
        let bytes = base64::engine::general_purpose::STANDARD.decode("djEwtlYo7Pms0Xsl1BHJmv/9U3I75lfsp9CZnrq9DSiAoVI=").unwrap();
        assert_eq!(decrypt_macos(&bytes, "synthetic-cursor-password").unwrap(), "synthetic-cursor-token");
        assert!(decrypt_macos(&bytes, "wrong-password").is_err());
        assert!(decrypt_macos(b"v20future-format", "synthetic-cursor-password").is_err());
        assert!(decrypt_macos(b"v10truncated", "synthetic-cursor-password").is_err());
    }
    #[test]
    fn unknown_seals_and_header_injection_are_rejected_without_disclosing_tokens() {
        assert_eq!(token("synthetic-plain-cursor-token").unwrap(), "synthetic-plain-cursor-token");
        for raw in ["cursor-safe-storage:v2:private-ciphertext", "cursor-safe-storage:v1:invalid-base64", "secret\r\nAuthorization: injected", ""] {
            let error = token(raw).err().unwrap();
            assert!(!error.contains("private-ciphertext") && !error.contains("Authorization:"));
        }
    }
}
