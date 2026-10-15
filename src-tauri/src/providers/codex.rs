use serde_json::{json, Value};
use std::{ffi::OsString, io::{BufRead, BufReader, Read, Write}, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::mpsc, time::{Duration, Instant}};

// Target triples and npm platform packages, as mapped by the official @openai/codex launcher.
const WINDOWS: [(&str, &str); 2] = [("x86_64-pc-windows-msvc", "codex-win32-x64"), ("aarch64-pc-windows-msvc", "codex-win32-arm64")];
const MACOS: [(&str, &str); 2] = [("x86_64-apple-darwin", "codex-darwin-x64"), ("aarch64-apple-darwin", "codex-darwin-arm64")];
const LINUX: [(&str, &str); 2] = [("x86_64-unknown-linux-musl", "codex-linux-x64"), ("aarch64-unknown-linux-musl", "codex-linux-arm64")];

#[derive(Clone, Copy, PartialEq)]
pub enum Os { Windows, Mac, Linux }

pub struct Search { os: Os, arm: bool, bins: Vec<PathBuf>, modules: Vec<PathBuf> }

// Version folders (nvm, fnm, pnpm), newest first.
fn versions(folder: PathBuf, suffix: &str) -> Vec<PathBuf> {
    let mut rows: Vec<(Vec<u64>, PathBuf)> = std::fs::read_dir(folder).into_iter().flatten().flatten().map(|entry| {
        let name = entry.file_name().to_string_lossy().into_owned();
        (name.trim_start_matches('v').split('.').map(|part| part.parse().unwrap_or(0)).collect(), if suffix.is_empty() { entry.path() } else { entry.path().join(suffix) })
    }).collect();
    rows.sort_by(|left, right| right.0.cmp(&left.0));
    rows.into_iter().take(32).map(|(_, path)| path).collect()
}

// A Finder or Dock launch inherits launchd's minimal PATH, so the usual install locations are added explicitly.
pub fn search(os: Os, arm: bool, var: &dyn Fn(&str) -> Option<OsString>, home: Option<&Path>) -> Search {
    let folder = |name: &str| var(name).map(PathBuf::from).filter(|path| path.is_absolute());
    let windows = os == Os::Windows;
    let mut bins: Vec<PathBuf> = var("PATH").map(|value| std::env::split_paths(&value).filter(|path| path.is_absolute()).collect()).unwrap_or_default();
    let mut modules = Vec::new();
    if let Some(home) = home {
        let (local, roaming) = (folder("LOCALAPPDATA").unwrap_or(home.join("AppData/Local")), folder("APPDATA").unwrap_or(home.join("AppData/Roaming")));
        let data = folder("XDG_DATA_HOME").unwrap_or(home.join(".local/share"));
        bins.extend([".local/bin", ".cargo/bin", ".npm-global/bin", ".bun/bin", "bin"].map(|path| home.join(path)));
        for nvm in [folder("NVM_DIR"), Some(home.join(".nvm"))].into_iter().flatten() { bins.extend(versions(nvm.join("versions/node"), "bin")); }
        let fnm = match os { Os::Mac => home.join("Library/Application Support/fnm"), Os::Linux => data.join("fnm"), Os::Windows => roaming.join("fnm") };
        for fnm in [folder("FNM_DIR"), Some(fnm), Some(home.join(".fnm"))].into_iter().flatten() { bins.extend(versions(fnm.join("node-versions"), if windows { "installation" } else { "installation/bin" })); }
        let volta = folder("VOLTA_HOME").unwrap_or(if windows { local.join("Volta") } else { home.join(".volta") });
        modules.extend(["lib/node_modules", "node_modules"].map(|path| volta.join("tools/image/packages/@openai/codex").join(path)));
        modules.push(folder("BUN_INSTALL").unwrap_or(home.join(".bun")).join("install/global/node_modules"));
        let pnpm = folder("PNPM_HOME").unwrap_or(match os { Os::Mac => home.join("Library/pnpm"), Os::Linux => data.join("pnpm"), Os::Windows => local.join("pnpm") });
        modules.extend(versions(pnpm.join("global"), "node_modules"));
        if windows { bins.push(roaming.join("npm")); }
    }
    match os {
        Os::Mac => bins.extend(["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"].map(PathBuf::from)),
        Os::Linux => bins.extend(["/usr/local/bin", "/home/linuxbrew/.linuxbrew/bin"].map(PathBuf::from)),
        Os::Windows => {
            if let Some(nvm) = folder("NVM_HOME") { bins.extend(versions(nvm, "")); }
            bins.extend(folder("ProgramFiles").map(|path| path.join("nodejs")));
        }
    }
    Search { os, arm, bins, modules }
}

// A native executable: Node or shell scripts and Volta shims need Node on a PATH that a Finder launch does not have.
fn native(path: &Path) -> bool {
    let mut head = [0; 2];
    path.is_file() && !path.canonicalize().is_ok_and(|real| real.file_name().is_some_and(|name| name.to_string_lossy().starts_with("volta-shim")))
        && std::fs::File::open(path).and_then(|mut file| file.read_exact(&mut head)).is_ok() && &head != b"#!"
}

// Never use a shell or search the current working directory for an executable.
pub fn find(search: &Search) -> Option<PathBuf> {
    let name = if search.os == Os::Windows { "codex.exe" } else { "codex" };
    let mut targets = match search.os { Os::Windows => WINDOWS, Os::Mac => MACOS, Os::Linux => LINUX }.to_vec();
    targets.sort_by_key(|(triple, _)| triple.starts_with("aarch64") != search.arm);
    // The official npm package ships the native binary in a platform package, nested or hoisted, or in its own vendor folder.
    let package = |root: &Path| -> Option<PathBuf> {
        if !root.parent()?.is_dir() { return None; }
        for root in [Some(root.to_path_buf()), root.canonicalize().ok()].into_iter().flatten() {
            for (triple, platform) in &targets {
                for base in [Some(root.join("node_modules/@openai").join(platform)), root.parent().map(|scope| scope.join(platform)), Some(root.clone())].into_iter().flatten() {
                    for folder in ["bin", "codex"] {
                        let candidate = base.join("vendor").join(triple).join(folder).join(name);
                        if native(&candidate) { return Some(candidate); }
                    }
                }
            }
        }
        None
    };
    for bin in search.bins.iter().filter(|path| path.is_absolute()) {
        let candidate = bin.join(name);
        if native(&candidate) { return Some(candidate); }
        // npm, nvm, fnm and Homebrew Node shims link to bin/codex.js; run the packaged native binary instead.
        let linked = bin.join("codex").canonicalize().ok().filter(|real| real.file_name().is_some_and(|file| file == "codex.js")).and_then(|real| Some(real.parent()?.parent()?.to_path_buf()));
        let prefixes = [linked, Some(bin.join("node_modules/@openai/codex")), bin.parent().map(|prefix| prefix.join("lib/node_modules/@openai/codex"))];
        if let Some(found) = prefixes.into_iter().flatten().find_map(|root| package(&root)) { return Some(found); }
    }
    search.modules.iter().find_map(|modules| package(&modules.join("@openai/codex")))
}

fn executable() -> Option<PathBuf> {
    let os = if cfg!(windows) { Os::Windows } else if cfg!(target_os = "macos") { Os::Mac } else { Os::Linux };
    find(&search(os, cfg!(target_arch = "aarch64"), &|name| std::env::var_os(name), dirs::home_dir().as_deref()))
}

struct Server(Child);
impl Drop for Server { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }

fn hello() -> Value { json!({"id":0,"method":"initialize","params":{"clientInfo":{"name":"meterluma","title":"MeterLuma","version":env!("CARGO_PKG_VERSION")}}}) }

pub fn limits(root: &Path) -> Result<Value, String> {
    let program = executable().ok_or("Install the official Codex CLI and sign in there to read quotas. Local history still works.")?;
    let mut command = Command::new(program);
    command.args(["app-server", "--listen", "stdio://"]).env("CODEX_HOME", root)
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    // The guard kills and reaps the app-server on every return path, including errors, timeouts and panics.
    let mut server = Server(command.spawn().map_err(|_| "The official Codex app-server could not be started.")?);
    let input = server.0.stdin.take().ok_or("Codex input was unavailable.")?;
    let output = server.0.stdout.take().ok_or("Codex output was unavailable.")?;
    exchange(input, output, Duration::from_secs(20))
}

fn exchange(mut input: impl Write, output: impl Read + Send + 'static, limit: Duration) -> Result<Value, String> {
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
    let mut send = |value: Value| -> Result<(), String> {
        writeln!(input, "{value}").and_then(|_| input.flush()).map_err(|_| "The Codex app-server request could not be sent.".into())
    };
    send(hello())?;
    let deadline = Instant::now() + limit;
    loop {
        let wait = deadline.checked_duration_since(Instant::now()).ok_or("Codex quota lookup timed out. Local history is still available.")?;
        let line = receiver.recv_timeout(wait).map_err(|_| "Codex quota lookup timed out or closed. Update the official CLI and sign in again.")?
            .map_err(|_| "The Codex app-server response exceeded the safe size limit.")?;
        let value: Value = serde_json::from_slice(&line).map_err(|_| "The Codex app-server returned an unsupported response.")?;
        if value["id"] == 0 {
            if value.get("error").is_some() { return Err("Codex app-server initialization failed. Update the official CLI.".into()); }
            send(json!({"method":"initialized","params":{}}))?;
            send(json!({"id":1,"method":"account/rateLimits/read"}))?;
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
    use std::collections::HashMap;

    struct Fixture(PathBuf);
    impl Drop for Fixture { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
    fn fixture(name: &str) -> Fixture { Fixture(std::env::temp_dir().join(format!("meterluma-codex-{name}-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap()))) }
    fn file(path: &Path, contents: &[u8]) { std::fs::create_dir_all(path.parent().unwrap()).unwrap(); std::fs::write(path, contents).unwrap(); }
    fn env(values: &[(&str, OsString)]) -> impl Fn(&str) -> Option<OsString> {
        let values: HashMap<String, OsString> = values.iter().map(|(key, value)| (key.to_string(), value.clone())).collect();
        move |name| values.get(name).cloned()
    }
    const NATIVE: &[u8] = b"\xcf\xfa\xed\xfe native fixture";
    const SCRIPT: &[u8] = b"#!/usr/bin/env node\n";

    #[test]
    fn windows_npm_layouts_include_arm64_and_never_search_relative_paths() {
        let root = fixture("windows");
        for (arm, layout) in [
            (false, "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"),
            (false, "node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/codex/codex.exe"),
            (false, "node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"),
            (true, "node_modules/@openai/codex/node_modules/@openai/codex-win32-arm64/vendor/aarch64-pc-windows-msvc/bin/codex.exe"),
            (false, "node_modules/@openai/codex/node_modules/@openai/codex-win32-arm64/vendor/aarch64-pc-windows-msvc/bin/codex.exe"),
        ] {
            let binary = root.0.join(layout);
            file(&binary, b"MZ discovery fixture");
            let search = Search { os: Os::Windows, arm, bins: vec![PathBuf::from("."), root.0.clone()], modules: vec![] };
            assert_eq!(find(&search), Some(binary.clone()), "{layout}");
            std::fs::remove_file(binary).unwrap();
        }
        let x64 = root.0.join("node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe");
        let arm64 = root.0.join("node_modules/@openai/codex/node_modules/@openai/codex-win32-arm64/vendor/aarch64-pc-windows-msvc/bin/codex.exe");
        file(&x64, b"MZ"); file(&arm64, b"MZ");
        assert_eq!(find(&Search { os: Os::Windows, arm: true, bins: vec![root.0.clone()], modules: vec![] }), Some(arm64));
        assert_eq!(find(&Search { os: Os::Windows, arm: false, bins: vec![root.0.clone()], modules: vec![] }), Some(x64));
        assert_eq!(find(&Search { os: Os::Windows, arm: false, bins: vec![PathBuf::from("."), PathBuf::from("relative")], modules: vec![] }), None);
        let path = std::env::join_paths([PathBuf::from("relative/bin"), root.0.join("bin")]).unwrap();
        let search = search(Os::Windows, false, &env(&[("PATH", path), ("APPDATA", root.0.join("Roaming").into())]), Some(&root.0));
        assert!(search.bins.iter().all(|path| path.is_absolute()) && search.bins.contains(&root.0.join("Roaming/npm")));
    }

    #[test]
    fn macos_npm_nvm_fnm_volta_bun_and_homebrew_installs_resolve_to_the_native_binary() {
        let home = fixture("macos");
        let brew = home.0.join("opt/homebrew");
        let path = std::env::join_paths([PathBuf::from("/usr/bin"), brew.join("bin")]).unwrap();
        let arm = |prefix: &Path| prefix.join("node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex");
        let cases: Vec<(&str, Option<PathBuf>, PathBuf)> = vec![
            ("Homebrew Node npm prefix", Some(brew.join("bin/codex")), arm(&brew.join("lib"))),
            ("npm user prefix", Some(home.0.join(".npm-global/bin/codex")), arm(&home.0.join(".npm-global/lib"))),
            ("nvm", Some(home.0.join(".nvm/versions/node/v22.11.0/bin/codex")), arm(&home.0.join(".nvm/versions/node/v22.11.0/lib"))),
            ("fnm legacy vendor folder", Some(home.0.join("Library/Application Support/fnm/node-versions/v20.1.0/installation/bin/codex")), home.0.join("Library/Application Support/fnm/node-versions/v20.1.0/installation/lib/node_modules/@openai/codex/vendor/aarch64-apple-darwin/codex/codex")),
            ("Volta package image", Some(home.0.join(".volta/bin/codex")), arm(&home.0.join(".volta/tools/image/packages/@openai/codex/lib"))),
            ("bun hoisted package", None, home.0.join(".bun/install/global/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex")),
            ("Intel package under Rosetta", Some(brew.join("bin/codex")), brew.join("lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-x64/vendor/x86_64-apple-darwin/bin/codex")),
            ("Homebrew formula or cask", None, brew.join("bin/codex")),
            ("standalone install", None, home.0.join(".local/bin/codex")),
        ];
        for (layout, shim, binary) in cases {
            if let Some(shim) = &shim { file(shim, SCRIPT); }
            file(&binary, NATIVE);
            let search = search(Os::Mac, true, &env(&[("PATH", path.clone())]), Some(&home.0));
            assert_eq!(find(&search), Some(binary.clone()), "{layout}");
            std::fs::remove_file(&binary).unwrap();
            if let Some(shim) = shim { let _ = std::fs::remove_file(shim); }
        }
        file(&brew.join("bin/codex"), SCRIPT);
        assert_eq!(find(&search(Os::Mac, true, &env(&[("PATH", path.clone())]), Some(&home.0))), None, "a Node script is never launched without its native binary");
        let defaults = search(Os::Mac, true, &env(&[]), Some(&home.0));
        for folder in ["/opt/homebrew/bin", "/usr/local/bin"] { assert!(defaults.bins.contains(&PathBuf::from(folder)), "{folder}"); }
    }

    #[test]
    fn version_managers_are_searched_newest_first() {
        let home = fixture("versions");
        for version in ["v9.11.2", "v22.3.0", "v18.20.4"] { std::fs::create_dir_all(home.0.join(".nvm/versions/node").join(version).join("bin")).unwrap(); }
        let search = search(Os::Linux, false, &env(&[]), Some(&home.0));
        let found: Vec<_> = search.bins.iter().filter(|path| path.starts_with(home.0.join(".nvm"))).cloned().collect();
        assert_eq!(found, ["v22.3.0", "v18.20.4", "v9.11.2"].map(|version| home.0.join(".nvm/versions/node").join(version).join("bin")));
    }

    #[test]
    fn exchange_sends_only_quota_methods_with_the_app_version_and_enforces_bounds() {
        let responses = "{\"id\":0,\"result\":{}}\n{\"method\":\"note\"}\n{\"id\":1,\"result\":{\"rateLimits\":{\"primary\":{\"usedPercent\":7}}}}\n";
        let mut sent = Vec::new();
        let value = exchange(&mut sent, std::io::Cursor::new(responses.as_bytes().to_vec()), Duration::from_secs(5)).unwrap();
        assert_eq!(value["rateLimits"]["primary"]["usedPercent"], 7);
        let methods: Vec<Value> = String::from_utf8(sent).unwrap().lines().map(|line| serde_json::from_str::<Value>(line).unwrap()).collect();
        assert_eq!(methods.iter().map(|row| row["method"].as_str().unwrap()).collect::<Vec<_>>(), ["initialize", "initialized", "account/rateLimits/read"]);
        assert_eq!(methods[0]["params"]["clientInfo"]["version"], env!("CARGO_PKG_VERSION"));
        let oversized = exchange(Vec::new(), std::io::Cursor::new(vec![b'x'; 1_048_577]), Duration::from_secs(5)).err().unwrap();
        assert!(oversized.contains("safe size limit"));
        assert!(exchange(Vec::new(), std::io::empty(), Duration::from_secs(5)).err().unwrap().contains("closed"));
        assert!(exchange(Vec::new(), std::io::Cursor::new(b"{\"id\":0,\"error\":{}}\n".to_vec()), Duration::from_secs(5)).err().unwrap().contains("initialization failed"));
        struct Stall;
        impl Read for Stall { fn read(&mut self, _: &mut [u8]) -> std::io::Result<usize> { std::thread::sleep(Duration::from_secs(2)); Ok(0) } }
        let started = Instant::now();
        assert!(exchange(Vec::new(), Stall, Duration::from_millis(100)).err().unwrap().contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn codex_bucket_takes_precedence_and_missing_limits_stay_missing() {
        let data = normalized(&json!({"rateLimits":{"primary":{"usedPercent":99}},"rateLimitsByLimitId":{"codex":{"primary":{"usedPercent":25,"windowDurationMins":300,"resetsAt":123}}}}));
        assert_eq!(data["rate_limit"]["primary_window"]["used_percent"],25);
        assert_eq!(data["rate_limit"]["primary_window"]["limit_window_seconds"],18000);
        assert!(data["rate_limit"]["secondary_window"]["used_percent"].is_null());
    }
}
