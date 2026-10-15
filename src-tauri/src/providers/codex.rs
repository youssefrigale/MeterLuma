use serde_json::{json, Value};
use std::{io::{BufRead, BufReader, Read, Write}, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::mpsc, time::{Duration, Instant}};

// Never use a shell or search the current working directory for an executable.
fn executable() -> Option<PathBuf> {
    let mut paths: Vec<PathBuf> = std::env::var_os("PATH").map(|value| std::env::split_paths(&value).filter(|path| path.is_absolute()).collect()).unwrap_or_default();
    if let Some(home) = dirs::home_dir() { paths.extend([home.join(".local/bin"), home.join(".cargo/bin")]); }
    #[cfg(target_os = "macos")]
    paths.extend([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")]);
    find_executable(paths)
}

fn find_executable(paths: Vec<PathBuf>) -> Option<PathBuf> {
    let name = if cfg!(windows) { "codex.exe" } else { "codex" };
    for path in paths.into_iter().filter(|path| path.is_absolute()) {
        let candidate = path.join(name);
        if candidate.is_file() { return Some(candidate); }
        // The official npm installation also contains a standalone native binary.
        #[cfg(target_os = "windows")]
        {
            for package in ["node_modules/@openai/codex", "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64", "node_modules/@openai/codex-win32-x64"] {
                for directory in ["bin", "codex"] {
                    let candidate = path.join(package).join("vendor/x86_64-pc-windows-msvc").join(directory).join(name);
                    if candidate.is_file() { return Some(candidate); }
                }
            }
        }
    }
    None
}

struct Server(Child);
impl Drop for Server { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }

pub fn limits(root: &Path) -> Result<Value, String> {
    let program = executable().ok_or("Install the official Codex CLI native executable on PATH and sign in there to read quotas. Local history still works.")?;
    let mut command = Command::new(program);
    command.args(["app-server", "--listen", "stdio://"]).env("CODEX_HOME", root)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let mut server = Server(command.spawn().map_err(|_| "The official Codex app-server could not be started.")?);
    let mut input = server.0.stdin.take().ok_or("Codex input was unavailable.")?;
    let output = server.0.stdout.take().ok_or("Codex output was unavailable.")?;
    let (sender, receiver) = mpsc::sync_channel(8);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(output);
        let mut remaining = 1_048_576;
        while remaining > 0 {
            let mut line = Vec::new();
            match reader.by_ref().take((remaining + 1) as u64).read_until(b'\n', &mut line) {
                Ok(0) | Err(_) => break,
                Ok(length) => {
                    if length > remaining { let _ = sender.send(Err(())); break; }
                    remaining -= length;
                    if sender.send(Ok(line)).is_err() { break; }
                }
            }
        }
    });
    let send = |input: &mut std::process::ChildStdin, value: Value| -> Result<(), String> {
        writeln!(input, "{value}").and_then(|_| input.flush()).map_err(|_| "The Codex app-server request could not be sent.".into())
    };
    send(&mut input, json!({"id":0,"method":"initialize","params":{"clientInfo":{"name":"meterluma","title":"MeterLuma","version":"0.1.0"}}}))?;
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        let wait = deadline.checked_duration_since(Instant::now()).ok_or("Codex quota lookup timed out. Local history is still available.")?;
        let line = receiver.recv_timeout(wait).map_err(|_| "Codex quota lookup timed out or closed. Update the official CLI and sign in again.")?
            .map_err(|_| "The Codex app-server response exceeded the safe size limit.")?;
        let value: Value = serde_json::from_slice(&line).map_err(|_| "The Codex app-server returned an unsupported response.")?;
        if value["id"] == 0 {
            if value.get("error").is_some() { return Err("Codex app-server initialization failed. Update the official CLI.".into()); }
            send(&mut input, json!({"method":"initialized","params":{}}))?;
            send(&mut input, json!({"id":1,"method":"account/rateLimits/read"}))?;
        } else if value["id"] == 1 {
            if value.get("error").is_some() { return Err("Codex could not read quotas. Sign in using the official CLI; API-key-only accounts may not provide plan quotas.".into()); }
            return Ok(value["result"].clone());
        }
        // Notifications are ignored. No inference, thread, login, or tool methods are sent.
    }
}

pub fn normalized(value: &Value) -> Value {
    let bucket = value.pointer("/rateLimitsByLimitId/codex").filter(|value| value.is_object()).unwrap_or(&value["rateLimits"]);
    let window = |key: &str| {
        let row = &bucket[key];
        json!({"used_percent":row["usedPercent"],"reset_at":row["resetsAt"],"limit_window_seconds":row["windowDurationMins"].as_i64().and_then(|minutes| minutes.checked_mul(60))})
    };
    json!({"plan_type":bucket["planType"],"rate_limit":{"primary_window":window("primary"),"secondary_window":window("secondary")}})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "windows")]
    #[test]
    fn discovers_current_and_legacy_npm_executables_without_searching_relative_paths() {
        let root = std::env::temp_dir().join(format!("meterluma-codex-discovery-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        struct Cleanup(PathBuf);
        impl Drop for Cleanup { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
        let _cleanup = Cleanup(root.clone());
        for layout in ["node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe", "node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe", "node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"] {
            let binary = root.join(layout);
            std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
            std::fs::write(&binary, b"discovery fixture").unwrap();
            assert_eq!(find_executable(vec![PathBuf::from("."), root.clone()]), Some(binary.clone()));
            std::fs::remove_file(binary).unwrap();
        }
        assert_eq!(find_executable(vec![PathBuf::from(".")]), None);
    }
    #[test]
    fn codex_bucket_takes_precedence_and_missing_limits_stay_missing() {
        let data = normalized(&json!({"rateLimits":{"primary":{"usedPercent":99}},"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":123}}}}));
        assert_eq!(data["rate_limit"]["primary_window"]["used_percent"],25);
        assert_eq!(data["rate_limit"]["primary_window"]["limit_window_seconds"],18000);
        assert!(data["rate_limit"]["secondary_window"]["used_percent"].is_null());
    }
}
