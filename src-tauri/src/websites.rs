fn website(provider_id: &str, page: &str) -> Option<&'static str> {
    match (provider_id, page) {
        ("claude", "status") => Some("https://status.claude.com/"),
        ("claude", "usage") => Some("https://claude.ai/settings/usage"),
        ("codex", "status") => Some("https://status.openai.com/"),
        ("codex", "usage") => Some("https://chatgpt.com/codex/settings/usage"),
        ("cursor", "status") => Some("https://status.cursor.com/"),
        ("cursor", "usage") => Some("https://cursor.com/dashboard"),
        _ => None,
    }
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
    use super::website;
    #[test]
    fn provider_pages_reject_arbitrary_urls_and_commands() {
        assert_eq!(website("codex", "usage"), Some("https://chatgpt.com/codex/settings/usage"));
        for provider in ["claude", "codex", "cursor"] {
            for page in ["status", "usage"] { assert!(website(provider, page).unwrap().starts_with("https://")); }
            assert!(website(provider, "file:///private").is_none());
        }
        assert!(website("https://example.com", "status").is_none());
        assert!(website("claude; command", "status").is_none());
    }
}
