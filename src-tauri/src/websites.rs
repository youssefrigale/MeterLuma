fn website(provider_id: &str, page: &str) -> Option<&'static str> {
    let url = match (provider_id, page) {
        ("claude", "status") => "https://status.claude.com/",
        ("claude", "usage") => "https://claude.ai/settings/usage",
        ("codex", "status") => "https://status.openai.com/",
        ("codex", "usage") => "https://chatgpt.com/codex/settings/usage",
        ("cursor", "status") => "https://status.cursor.com/",
        ("cursor", "usage") => "https://cursor.com/dashboard",
        _ => return None,
    };
    Some(url).filter(|url| plain_https(url))
}

/// An absolute HTTPS URL made only of characters that no shell, `open` or ShellExecute can read as anything else.
fn plain_https(url: &str) -> bool {
    url.strip_prefix("https://").is_some_and(|rest| {
        let host = rest.split('/').next().unwrap_or_default();
        host.contains('.') && !host.starts_with(['.', '-']) && !host.ends_with(['.', '-'])
            && host.bytes().all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-'))
            && rest.bytes().all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'/'))
    })
}

#[tauri::command]
pub fn open_provider_page(provider_id: String, page: String) -> Result<(), String> {
    let url = website(&provider_id, &page).ok_or("Unknown provider page")?;
    // Only these fixed HTTPS pages can be opened; the webview cannot pass arbitrary URLs or commands.
    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;
        #[link(name = "shell32")]
        extern "system" {
            fn ShellExecuteW(window: *mut c_void, operation: *const u16, file: *const u16, parameters: *const u16, directory: *const u16, show: i32) -> *mut c_void;
        }
        let operation: Vec<u16> = "open\0".encode_utf16().collect();
        let file: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
        // Null-terminated UTF-16 buffers remain alive for the entire OS call.
        let result = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), file.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
        if result as isize > 32 { Ok(()) } else { Err("The provider page could not be opened".into()) }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let program = if cfg!(target_os = "macos") { "/usr/bin/open" } else { "xdg-open" };
        let status = std::process::Command::new(program).arg(url)
            .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null())
            .status().map_err(|_| "The provider page could not be opened")?;
        if status.success() { Ok(()) } else { Err("The provider page could not be opened".into()) }
    }
}

#[cfg(test)]
mod tests {
    use super::{plain_https, website};
    #[test]
    fn provider_pages_reject_arbitrary_urls_and_commands() {
        assert_eq!(website("codex", "usage"), Some("https://chatgpt.com/codex/settings/usage"));
        for provider in ["claude", "codex", "cursor"] {
            for page in ["status", "usage"] { assert!(website(provider, page).is_some_and(plain_https)); }
            assert!(website(provider, "file:///private").is_none());
            assert!(website(provider, "https://example.com").is_none());
        }
        assert!(website("https://example.com", "status").is_none());
        assert!(website("claude; command", "status").is_none());
        assert!(website("CLAUDE", "status").is_none());
        assert!(website("", "").is_none());
    }
    #[test]
    fn only_plain_https_urls_pass() {
        for url in ["https://status.claude.com/", "https://cursor.com/dashboard", "https://chatgpt.com/codex/settings/usage"] { assert!(plain_https(url), "{url}"); }
        for url in [
            "http://cursor.com/dashboard", "file:///C:/Windows/System32/calc.exe", "javascript:alert(1)", "https://", "https:///etc/passwd",
            "https://localhost/", "https://cursor.com/a b", "https://cursor.com/\"&calc", "https://cursor.com/%2e%2e", "https://cursor.com/?q=1",
            "https://user@cursor.com/", "https://cursor.com:8443/", "https://.cursor.com/", "https://Cursor.com/", "-https://cursor.com/",
            " https://cursor.com/", "https://cursor.com/\n", "ms-settings:privacy", "\\\\server\\share",
        ] { assert!(!plain_https(url), "{url:?}"); }
    }
}
