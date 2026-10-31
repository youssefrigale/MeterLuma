use super::{catalog::ProviderSpec, command, mappers, Failure, Snapshot};
use serde_json::Value;
use std::process::{Command, Stdio};
fn run(program: &std::path::Path, arguments: &[&str]) -> Result<Value, String> {
    let mut command = Command::new(program);
    command
        .args(arguments)
        .env("ARKCLI_NO_UPDATE_NOTIFIER", "1")
        .env("ARKCLI_CALLER_TYPE", "ai_agent")
        .env("ARKCLI_CALLER_NAME", "meterluma")
        .env("ARKCLI_SKILL_NAME", "arkcli-usage")
        .stdin(Stdio::null())
        .current_dir(std::env::temp_dir());
    command::capture(command)
}
fn quota() -> Result<Value, String> {
    let names = if cfg!(windows) {
        vec!["arkcli.exe"]
    } else {
        vec!["arkcli"]
    };
    let program = command::executable(&names, &[".local/bin", ".arkcli-bp/bin"])
        .ok_or("Install the official BytePlus Ark CLI and sign in there before connecting.")?;
    let status = run(&program, &["auth", "status", "--format", "json"])?;
    if status["logged_in"] != true {
        return Err("Sign in using the BytePlus Ark CLI, then reconnect. MeterLuma does not start a login flow.".into());
    }
    run(&program, &["usage", "plan", "--format", "json"])
}
pub(super) async fn snapshot(spec: &ProviderSpec) -> Result<Snapshot, Failure> {
    let root = tauri::async_runtime::spawn_blocking(quota)
        .await
        .map_err(|_| Failure::unavailable("The BytePlus usage reader could not complete."))?
        .map_err(Failure::unavailable)?;
    let usage = mappers::map(
        "byteplus",
        &std::collections::BTreeMap::from([("quota".into(), root)]),
    )
    .map_err(Failure::unavailable)?;
    let mut snapshot = Snapshot::new(spec);
    snapshot.metrics = usage.metrics;
    snapshot.amounts = usage.amounts;
    snapshot.warning = usage.warning;
    snapshot.notice = usage.notice;
    Ok(snapshot)
}
