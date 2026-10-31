use super::auth::Credential;
use serde_json::Value;
use std::{io::Read, path::Path};

#[cfg(target_os = "macos")]
mod renewal;
const EXPIRED: &str = "Your Claude Code sign-in has expired.";

pub struct SignIn { pub credential: Credential, pub plan: String }

fn parse(bytes: &[u8]) -> Result<SignIn, String> {
    let document: Value = serde_json::from_slice(bytes).map_err(|_| "The Claude Code sign-in format is not supported.")?;
    let login = &document["claudeAiOauth"];
    let token = login["accessToken"].as_str().filter(|token| token.starts_with("sk-ant-oat") && token.len() <= 16_384 && token.is_ascii() && !token.bytes().any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control()))
        .ok_or("Sign in to Claude Code with your Claude subscription to read usage limits.")?;
    if login["expiresAt"].as_i64().is_some_and(|expires| expires <= chrono::Utc::now().timestamp_millis()) {
        return Err(EXPIRED.into());
    }
    if login["scopes"].as_array().is_some_and(|scopes| !scopes.iter().any(|scope| scope.as_str() == Some("user:profile"))) {
        return Err("Your Claude Code sign-in cannot read usage limits. Sign in again in Claude Code with your Claude account.".into());
    }
    let plan = match (login["subscriptionType"].as_str(), login["rateLimitTier"].as_str()) {
        (Some("max"), Some("default_claude_max_20x")) => "Max 20x",
        (Some("max"), Some("default_claude_max_5x")) => "Max 5x",
        (Some("pro"), _) => "Pro", (Some("max"), _) => "Max", (Some("team"), _) => "Team", (Some("enterprise"), _) => "Enterprise", _ => "Subscription",
    };
    Ok(SignIn { credential: Credential { token: token.to_string() }, plan: plan.into() })
}

fn file_sign_in(root: &Path) -> Result<SignIn, String> {
    let file = std::fs::File::open(root.join(".credentials.json")).map_err(|_| "Sign in to Claude Code on this device, then refresh here.")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if file.metadata().map_err(|_| "The Claude Code sign-in could not be checked.")?.permissions().mode() & 0o077 != 0 {
            return Err("The Claude Code credential file is readable by other users. Restrict its permissions before enabling live usage.".into());
        }
    }
    let mut bytes = Vec::new();
    file.take(65_537).read_to_end(&mut bytes).map_err(|_| "The Claude Code sign-in could not be read.")?;
    if bytes.len() > 65_536 { return Err("The Claude Code sign-in is unexpectedly large.".into()); }
    parse(&bytes)
}

pub fn sign_in(root: &Path, default_profile: bool) -> Result<SignIn, String> {
    let login = read_sign_in(root, default_profile);
    #[cfg(target_os = "macos")]
    if login.as_ref().err().is_some_and(|error| error == EXPIRED) { return renewal::renew(root, default_profile); }
    login
}

fn read_sign_in(root: &Path, default_profile: bool) -> Result<SignIn, String> {
    #[cfg(target_os = "macos")]
    { return stored_sign_in(root, &keychain_services(root, default_profile), &super::auth::keychain); }
    #[cfg(not(target_os = "macos"))]
    { let _ = default_profile; file_sign_in(root) }
}

#[cfg(any(target_os = "macos", test))]
fn keychain_services(root: &Path, default_profile: bool) -> Vec<String> {
    use sha2::{Digest, Sha256};
    let mut services = vec![format!("Claude Code-credentials-{:x}", Sha256::digest(root.to_string_lossy().as_bytes()))];
    services[0].truncate("Claude Code-credentials-".len() + 8);
    if let Ok(canonical) = root.canonicalize() {
        if canonical != root {
            let mut scoped = format!("Claude Code-credentials-{:x}", Sha256::digest(canonical.to_string_lossy().as_bytes()));
            scoped.truncate("Claude Code-credentials-".len() + 8); services.push(scoped);
        }
    }
    if default_profile && dirs::home_dir().is_some_and(|home| root == home.join(".claude")) { services.push("Claude Code-credentials".into()); }
    services
}

#[cfg(any(target_os = "macos", test))]
fn stored_sign_in(root: &Path, services: &[String], read: &dyn Fn(&str) -> Result<String, String>) -> Result<SignIn, String> {
    let mut invalid = None;
    for service in services {
        if let Ok(raw) = read(service) {
            match parse(raw.as_bytes()) { Ok(login) => return Ok(login), Err(error) => invalid = Some(error) }
        }
    }
    file_sign_in(root).map_err(|error| invalid.filter(|_| !root.join(".credentials.json").exists()).unwrap_or(error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scoped_credentials_do_not_borrow_another_home_and_expired_entries_do_not_shadow_valid_files() {
        let root = std::env::temp_dir().join(format!("meterluma-scoped-claude-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join(".credentials.json");
        let fresh = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-file-account","subscriptionType":"max","rateLimitTier":"default_claude_max_20x"}}"#;
        std::fs::write(&path, fresh).unwrap();
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap(); }
        let services = keychain_services(&root, false);
        assert!(services.iter().all(|service| service.starts_with("Claude Code-credentials-") && service.len() == 32));
        assert_ne!(services, keychain_services(&root.join("other-account"), false));
        let read = |_: &str| Ok(r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-stale-account","expiresAt":0}}"#.into());
        let login = stored_sign_in(&root, &services, &read).unwrap();
        assert_eq!(login.credential.token, "sk-ant-oat01-file-account"); assert_eq!(login.plan, "Max 20x");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), fresh);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn subscription_login_rejects_api_keys_expired_tokens_and_missing_profile_access() {
        let base = json!({"accessToken":"sk-ant-oat01-synthetic-test-token", "expiresAt":chrono::Utc::now().timestamp_millis()+600_000, "scopes":["user:profile"], "subscriptionType":"team"});
        let login = parse(&serde_json::to_vec(&json!({"claudeAiOauth":base})).unwrap()).unwrap();
        assert_eq!(login.plan, "Team");
        for (key, invalid) in [("accessToken", json!("sk-ant-api01-synthetic")), ("accessToken", json!("sk-ant-oat01-bad\nheader")), ("expiresAt", json!(0)), ("scopes", json!(["user:inference"]))] {
            let mut modified = base.clone(); modified[key] = invalid;
            let error = parse(&serde_json::to_vec(&json!({"claudeAiOauth":modified})).unwrap()).err().unwrap();
            assert!(!error.contains("sk-ant-"));
        }
    }

    #[test]
    fn valid_custom_profile_is_preserved_and_does_not_borrow_the_default_login() {
        let root = std::env::temp_dir().join(format!("meterluma-claude-auth-{}-{}",std::process::id(),chrono::Utc::now().timestamp_nanos_opt().unwrap()));
        std::fs::create_dir_all(&root).unwrap();
        assert!(sign_in(&root, false).is_err());
        let path = root.join(".credentials.json");
        let contents = br#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-synthetic-profile-token","scopes":["user:profile"],"subscriptionType":"team","refreshToken":"never-used-test-refresh"},"otherSetting":true}"#;
        std::fs::write(&path, contents).unwrap();
        #[cfg(unix)]
        { use std::os::unix::fs::PermissionsExt; std::fs::set_permissions(&path,std::fs::Permissions::from_mode(0o600)).unwrap(); }
        let login = sign_in(&root, false).unwrap();
        assert_eq!(login.credential.token, "sk-ant-oat01-synthetic-profile-token");
        assert_eq!(std::fs::read(&path).unwrap(), contents);
        std::fs::remove_dir_all(root).unwrap();
    }
}
