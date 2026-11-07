use super::SignIn;
use std::{collections::HashMap, io::{Read, Write}, os::unix::{fs::DirBuilderExt, process::CommandExt}, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::Mutex, time::{Duration, Instant}};
use wait_timeout::ChildExt;

const RETRY: &str = "Claude Code could not renew usage access yet. MeterLuma will retry automatically.";
const TIMEOUT: Duration = Duration::from_secs(25);
/// Waits between attempts for one profile after 1, 2, 3, 4 and 5+ unsuccessful attempts, so an
/// offline Mac or a CLI that cannot renew does not start a new session every poll.
const BACKOFF_MINUTES: [u64; 5] = [1, 2, 5, 15, 60];

struct Attempt { started: Instant, unsuccessful: u32 }
static ATTEMPTS: Mutex<Option<HashMap<PathBuf, Attempt>>> = Mutex::new(None);
/// Process groups of renewals in progress, stopped when MeterLuma quits so no CLI outlives it.
static RUNNING: Mutex<Vec<i32>> = Mutex::new(Vec::new());

unsafe extern "C" { fn kill(pid: i32, signal: i32) -> i32; }

fn backoff(unsuccessful: u32) -> Duration {
    let index = (unsuccessful.max(1) as usize - 1).min(BACKOFF_MINUTES.len() - 1);
    Duration::from_secs(BACKOFF_MINUTES[index] * 60)
}

fn forget_attempts(root: &Path) {
    if let Ok(mut attempts) = ATTEMPTS.lock() { if let Some(attempts) = attempts.as_mut() { attempts.remove(root); } }
}

/// Stops every renewal still running. Called when the app exits.
pub fn stop_all() {
    let groups = RUNNING.lock().map(|mut running| std::mem::take(&mut *running)).unwrap_or_default();
    for group in groups { unsafe { kill(-group, 9); } }
}

fn executable() -> Option<PathBuf> {
    let mut folders: Vec<PathBuf> = std::env::var_os("PATH").map(|path| std::env::split_paths(&path).filter(|folder| folder.is_absolute()).collect()).unwrap_or_default();
    if let Some(home) = dirs::home_dir() { folders.extend([home.join(".local/bin"), home.join(".bun/bin"), home.join("bin")]); }
    folders.extend([PathBuf::from("/opt/homebrew/bin"), PathBuf::from("/usr/local/bin")]);
    folders.into_iter().map(|folder| folder.join("claude")).find(|path| {
        let mut head = [0; 2];
        path.is_file() && std::fs::File::open(path).and_then(|mut file| file.read_exact(&mut head)).is_ok() && &head != b"#!"
    })
}

struct EmptyWorkspace(PathBuf);
impl EmptyWorkspace {
    fn new() -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("meterluma-claude-renew-{}-{}", std::process::id(), chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()));
        std::fs::DirBuilder::new().mode(0o700).create(&path).map_err(|_| "A private Claude renewal workspace could not be created.")?;
        Ok(Self(path))
    }
}
impl Drop for EmptyWorkspace { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

struct RenewalProcess(Child);
impl RenewalProcess {
    fn running(&mut self) -> bool { matches!(self.0.try_wait(), Ok(None)) }
}
impl Drop for RenewalProcess {
    fn drop(&mut self) {
        let group = self.0.id() as i32;
        if let Ok(mut running) = RUNNING.lock() { running.retain(|candidate| *candidate != group); }
        if let Some(mut input) = self.0.stdin.take() { let _ = input.write_all(b"\x1b"); }
        if self.0.wait_timeout(Duration::from_secs(1)).is_ok_and(|status| status.is_some()) { return; }
        // Closing script's private PTY hangs up its CLI; no waiting trust/login prompt is left behind.
        unsafe { kill(-group, 9); }
        let _ = self.0.wait();
    }
}

fn launch(program: &Path, root: &Path, workspace: &Path) -> Result<RenewalProcess, String> {
    let mut command = Command::new("/usr/bin/script");
    command.args(["-q", "/dev/null"]).arg(program)
        .args(["--safe-mode", "--tools", "", "--strict-mcp-config", "--mcp-config", "{\"mcpServers\":{}}", "--setting-sources", "", "--settings", "{\"cleanupPeriodDays\":1000000,\"disableAllHooks\":true}"])
        .current_dir(workspace).process_group(0).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null())
        .env("DISABLE_AUTOUPDATER", "1").env("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1");
    for name in ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"] { command.env_remove(name); }
    if dirs::home_dir().is_some_and(|home| root == home.join(".claude")) { command.env_remove("CLAUDE_CONFIG_DIR"); }
    else { command.env("CLAUDE_CONFIG_DIR", root); }
    let mut running = RUNNING.lock().map_err(|_| "Claude renewal is unavailable. Restart MeterLuma.")?;
    let child = command.spawn().map_err(|_| "Claude Code could not start automatic renewal. Update the official Claude Code CLI.")?;
    running.push(child.id() as i32);
    Ok(RenewalProcess(child))
}

/// Polls for the renewed sign-in until the timeout, or until the CLI has exited on its own.
fn wait_for_login(read: &dyn Fn() -> Result<SignIn, String>, mut cli_running: impl FnMut() -> bool, timeout: Duration) -> Result<SignIn, String> {
    let started = Instant::now();
    while started.elapsed() < timeout && cli_running() {
        match read() {
            Ok(login) => return Ok(login),
            Err(error) if error != super::EXPIRED => return Err(error),
            Err(_) => {}
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    read().map_err(|_| RETRY.into())
}

pub(super) fn renew(root: &Path, default_profile: bool) -> Result<SignIn, String> {
    let read = || super::read_sign_in(root, default_profile);
    match read() {
        Ok(login) => { forget_attempts(root); return Ok(login); }
        Err(error) if error != super::EXPIRED => return Err(error),
        Err(_) => {}
    }
    let program = executable().ok_or("Install the official native Claude Code CLI to renew usage access automatically.")?;
    {
        // Held only to claim the attempt, so other profiles never wait behind this renewal.
        let mut attempts = ATTEMPTS.lock().map_err(|_| "Claude renewal is unavailable. Restart MeterLuma.")?;
        let attempts = attempts.get_or_insert_with(HashMap::new);
        let unsuccessful = attempts.get(root).map_or(0, |attempt| attempt.unsuccessful);
        if attempts.get(root).is_some_and(|attempt| attempt.started.elapsed() < backoff(attempt.unsuccessful)) { return Err(RETRY.into()); }
        attempts.insert(root.to_path_buf(), Attempt { started: Instant::now(), unsuccessful: unsuccessful + 1 });
    }
    let workspace = EmptyWorkspace::new()?;
    let mut process = launch(&program, root, &workspace.0)?;
    let login = wait_for_login(&read, || process.running(), TIMEOUT);
    if login.is_ok() { forget_attempts(root); }
    login
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// `stop_all` stops every renewal in the process, so tests that launch one take turns.
    static LAUNCHES: Mutex<()> = Mutex::new(());
    fn serial() -> std::sync::MutexGuard<'static, ()> { LAUNCHES.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) }

    #[test]
    fn expired_login_recovers_from_cli_rotation_and_stops_the_waiting_process() {
        let _serial = serial();
        let workspace = EmptyWorkspace::new().unwrap();
        let program = workspace.0.join("claude");
        let credential = workspace.0.join(".credentials.json");
        let expired = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-expired-fixture","expiresAt":0}}"#;
        std::fs::write(&credential, expired).unwrap();
        std::fs::set_permissions(&credential, std::fs::Permissions::from_mode(0o600)).unwrap();
        let fresh = format!(r#"{{"claudeAiOauth":{{"accessToken":"sk-ant-oat01-renewed-fixture","expiresAt":{},"subscriptionType":"team"}}}}"#, chrono::Utc::now().timestamp_millis() + 600_000);
        std::fs::write(&program, format!("#!/bin/sh\nprintf '%s' '{}' > \"$CLAUDE_CONFIG_DIR/.credentials.json\"\nprintf '%s' \"$$\" > \"$CLAUDE_CONFIG_DIR/worker.pid\"\nexec /bin/sleep 30\n", fresh)).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut process = launch(&program, &workspace.0, &workspace.0).unwrap();
        let login = wait_for_login(&|| super::super::file_sign_in(&workspace.0), || process.running(), Duration::from_secs(5)).unwrap();
        assert_eq!(login.credential.token, "sk-ant-oat01-renewed-fixture");
        assert_eq!(login.plan, "Team");
        assert_eq!(std::fs::read_to_string(&credential).unwrap(), fresh);
        let worker: i32 = std::fs::read_to_string(workspace.0.join("worker.pid")).unwrap().parse().unwrap();
        drop(process);
        let cleanup = Instant::now();
        while unsafe { kill(worker, 0) } == 0 && cleanup.elapsed() < Duration::from_secs(2) { std::thread::sleep(Duration::from_millis(20)); }
        assert_ne!(unsafe { kill(worker, 0) }, 0, "The CLI worker must not outlive renewal");
    }

    #[test]
    fn failed_renewal_preserves_credentials_and_returns_a_retryable_error() {
        let _serial = serial();
        let workspace = EmptyWorkspace::new().unwrap();
        let program = workspace.0.join("claude");
        let credential = workspace.0.join(".credentials.json");
        let expired = r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-expired-fixture","expiresAt":0}}"#;
        std::fs::write(&credential, expired).unwrap();
        std::fs::set_permissions(&credential, std::fs::Permissions::from_mode(0o600)).unwrap();
        std::fs::write(&program, "#!/bin/sh\nexec /bin/sleep 30\n").unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut process = launch(&program, &workspace.0, &workspace.0).unwrap();
        let error = wait_for_login(&|| super::super::file_sign_in(&workspace.0), || process.running(), Duration::from_millis(500)).err().unwrap();
        assert_eq!(error, RETRY);
        assert_eq!(std::fs::read_to_string(&credential).unwrap(), expired);
        assert!(!error.contains("sk-ant"));
    }

    #[test]
    fn a_cli_that_exits_early_ends_the_wait_and_quitting_stops_running_renewals() {
        let _serial = serial();
        let workspace = EmptyWorkspace::new().unwrap();
        let credential = workspace.0.join(".credentials.json");
        std::fs::write(&credential, r#"{"claudeAiOauth":{"accessToken":"sk-ant-oat01-expired-fixture","expiresAt":0}}"#).unwrap();
        std::fs::set_permissions(&credential, std::fs::Permissions::from_mode(0o600)).unwrap();
        let exits = workspace.0.join("claude-exits");
        std::fs::write(&exits, "#!/bin/sh\nexit 2\n").unwrap();
        std::fs::set_permissions(&exits, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut process = launch(&exits, &workspace.0, &workspace.0).unwrap();
        let started = Instant::now();
        assert_eq!(wait_for_login(&|| super::super::file_sign_in(&workspace.0), || process.running(), Duration::from_secs(20)).err().unwrap(), RETRY);
        assert!(started.elapsed() < Duration::from_secs(5), "An exited CLI must not hold renewal for the full timeout");
        drop(process);

        let waits = workspace.0.join("claude-waits");
        std::fs::write(&waits, "#!/bin/sh\nprintf '%s' \"$$\" > \"$CLAUDE_CONFIG_DIR/waiting.pid\"\nexec /bin/sleep 30\n").unwrap();
        std::fs::set_permissions(&waits, std::fs::Permissions::from_mode(0o700)).unwrap();
        let process = launch(&waits, &workspace.0, &workspace.0).unwrap();
        let pid_file = workspace.0.join("waiting.pid");
        let ready = Instant::now();
        while !pid_file.exists() && ready.elapsed() < Duration::from_secs(5) { std::thread::sleep(Duration::from_millis(20)); }
        let worker: i32 = std::fs::read_to_string(&pid_file).unwrap().parse().unwrap();
        stop_all();
        let cleanup = Instant::now();
        while unsafe { kill(worker, 0) } == 0 && cleanup.elapsed() < Duration::from_secs(2) { std::thread::sleep(Duration::from_millis(20)); }
        assert_ne!(unsafe { kill(worker, 0) }, 0, "Quitting must stop a renewal that is still waiting");
        drop(process);
    }

    #[test]
    fn unsuccessful_attempts_back_off_up_to_an_hour() {
        assert_eq!(backoff(0), Duration::from_secs(60));
        assert_eq!(backoff(1), Duration::from_secs(60));
        assert_eq!(backoff(2), Duration::from_secs(120));
        assert_eq!(backoff(3), Duration::from_secs(300));
        assert_eq!(backoff(4), Duration::from_secs(900));
        assert_eq!(backoff(5), Duration::from_secs(3600));
        assert_eq!(backoff(50), Duration::from_secs(3600));
    }
}
