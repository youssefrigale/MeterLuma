use std::{
    io::Read,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};
pub(super) struct Process(pub Child);
impl Process {
    pub fn spawn(mut command: Command) -> Result<Self, String> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map(Self)
            .map_err(|_| "The provider usage reader could not start.".into())
    }
}
impl Drop for Process {
    fn drop(&mut self) {
        #[cfg(unix)]
        if let Ok(group) = i32::try_from(self.0.id()) {
            unsafe extern "C" {
                fn kill(pid: i32, signal: i32) -> i32;
            }
            // Every reader owns a separate process group, including any CLI worker children.
            unsafe {
                kill(-group, 9);
            }
        }
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
pub(super) fn executable(names: &[&str], extra: &[&str]) -> Option<PathBuf> {
    let mut directories: Vec<_> = std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).collect())
        .unwrap_or_default();
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    if let Some(home) = dirs::home_dir() {
        directories.extend(extra.iter().map(|path| home.join(path)));
    }
    directories
        .into_iter()
        .flat_map(|directory| names.iter().map(move |name| directory.join(name)))
        .find(|path| path.is_file())
}
pub(super) fn capture(command: Command) -> Result<serde_json::Value, String> {
    capture_with_timeout(command, Duration::from_secs(20))
}
fn capture_with_timeout(command: Command, timeout: Duration) -> Result<serde_json::Value, String> {
    use wait_timeout::ChildExt;
    let mut process = Process::spawn(command)?;
    let output = process
        .0
        .stdout
        .take()
        .ok_or("The provider returned no usage stream.")?;
    let (sender, receiver) = mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        let result = output
            .take(1_048_577)
            .read_to_end(&mut bytes)
            .map(|_| bytes);
        let _ = sender.send(result);
    });
    let bytes = receiver
        .recv_timeout(timeout)
        .map_err(|_| "The provider usage command timed out.")?
        .map_err(|_| "The provider usage stream could not be read.")?;
    if bytes.len() > 1_048_576 {
        return Err("The provider usage stream exceeds the read limit.".into());
    }
    let status = process
        .0
        .wait_timeout(Duration::from_secs(1))
        .map_err(|_| "The provider usage reader did not exit cleanly.")?
        .ok_or("The provider usage reader did not finish.")?;
    if !status.success() {
        return Err(
            "The provider usage reader failed. Open its CLI and check your sign-in.".into(),
        );
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| "The provider CLI returned an unsupported usage format.".into())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn reader_timeout_and_nonzero_exit_do_not_return_fabricated_usage() {
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "sleep 30"]);
        let start = std::time::Instant::now();
        assert!(capture_with_timeout(command, Duration::from_millis(250))
            .unwrap_err()
            .contains("timed out"));
        assert!(start.elapsed() < Duration::from_secs(3));
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "printf '{}'; exit 1"]);
        assert!(capture(command).unwrap_err().contains("failed"));
    }
}
