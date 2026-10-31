use super::{catalog::ProviderSpec, command, mappers, Failure, Snapshot};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};
fn lines(output: impl Read + Send + 'static) -> mpsc::Receiver<Result<Value, String>> {
    let (sender, receiver) = mpsc::sync_channel(4);
    std::thread::spawn(move || {
        let mut reader = BufReader::new(output);
        let mut budget = 1_048_576usize;
        loop {
            let mut line = Vec::new();
            let result = reader
                .by_ref()
                .take(budget.min(262_144) as u64 + 1)
                .read_until(b'\n', &mut line);
            let length = match result {
                Ok(0) => break,
                Ok(length) => length,
                Err(_) => {
                    let _ = sender.send(Err("Qoder's usage response could not be read.".into()));
                    break;
                }
            };
            if length > budget || length > 262_144 {
                let _ = sender.send(Err("Qoder's usage response exceeds the read limit.".into()));
                break;
            }
            budget -= length;
            if line.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            let value = serde_json::from_slice(&line)
                .map_err(|_| "Qoder returned an unsupported usage response.".into());
            if sender.send(value).is_err() {
                break;
            }
        }
    });
    receiver
}
fn request(
    input: &mut impl Write,
    output: &mpsc::Receiver<Result<Value, String>>,
    id: &str,
    kind: &str,
) -> Result<Value, String> {
    writeln!(
        input,
        "{}",
        json!({"type":"control_request","request_id":id,"request":{"type":kind,"subtype":kind}})
    )
    .and_then(|_| input.flush())
    .map_err(|_| "Qoder's usage request could not be sent.")?;
    let deadline = Instant::now() + Duration::from_secs(15);
    for _ in 0..256 {
        let wait = deadline.saturating_duration_since(Instant::now());
        let raw = output
            .recv_timeout(wait)
            .map_err(|_| "Qoder did not return usage in time. Open Qoder, sign in and retry.")??;
        if raw["type"] == "control_request" {
            return Err("Qoder requested an interactive action. Open Qoder separately; MeterLuma does not approve tools or sign-in actions.".into());
        }
        if raw["type"] != "control_response" || raw["response"]["request_id"] != id {
            continue;
        }
        if raw["response"]["subtype"] != "success" {
            return Err(
                "Qoder could not read account usage. Open Qoder and check its sign-in.".into(),
            );
        }
        return Ok(raw["response"]["response"].clone());
    }
    Err("Qoder returned too many unrelated control messages.".into())
}
fn quota() -> Result<Value, String> {
    let names = if cfg!(windows) {
        vec!["qodercli.exe", "qoder.exe"]
    } else {
        vec!["qodercli", "qoder"]
    };
    let program = command::executable(&names, &[".local/bin", ".qoder/bin"])
        .ok_or("Install the official Qoder CLI and sign in there, then connect again.")?;
    let mut command = Command::new(program);
    command
        .args([
            "--print",
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--no-session-persistence",
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--disable-builtin-skills",
        ])
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let mut process = command::Process::spawn(command)?;
    let mut input = process
        .0
        .stdin
        .take()
        .ok_or("Qoder input is unavailable.")?;
    let output = lines(
        process
            .0
            .stdout
            .take()
            .ok_or("Qoder output is unavailable.")?,
    );
    request(&mut input, &output, "meterluma-init", "initialize")?;
    request(&mut input, &output, "meterluma-usage", "get_usage_info")
}
pub(super) async fn snapshot(spec: &ProviderSpec) -> Result<Snapshot, Failure> {
    let response = tauri::async_runtime::spawn_blocking(quota)
        .await
        .map_err(|_| Failure::unavailable("The Qoder usage reader could not complete."))?
        .map_err(Failure::unavailable)?;
    let usage = mappers::map(
        "qoder",
        &std::collections::BTreeMap::from([("quota".into(), response)]),
    )
    .map_err(Failure::unavailable)?;
    let mut snapshot = Snapshot::new(spec);
    snapshot.plan = usage.plan;
    snapshot.metrics = usage.metrics;
    snapshot.amounts = usage.amounts;
    snapshot.notice = usage.notice;
    snapshot.warning = usage.warning;
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn control_usage_never_sends_a_prompt_or_approves_an_inbound_action() {
        let response = json!({"type":"control_response","response":{"subtype":"success","request_id":"usage","response":{"usage":{"userQuota":{"total":100,"used":25,"remaining":75,"unit":"Credits"}},"session":{"total_credits":50}}}});
        let output = lines(std::io::Cursor::new(format!("{response}\n")));
        let mut input = Vec::new();
        let result = request(&mut input, &output, "usage", "get_usage_info").unwrap();
        let usage = mappers::map(
            "qoder",
            &std::collections::BTreeMap::from([("quota".into(), result)]),
        )
        .unwrap();
        assert_eq!(usage.metrics[0].used_percent, 25.0);
        assert_eq!(usage.amounts[0].value, 75.0);
        let request: Value = serde_json::from_slice(&input).unwrap();
        assert_eq!(request["request"]["type"], "get_usage_info");
        assert_eq!(request["type"], "control_request");
        assert!(request.get("message").is_none());
        let output = lines(std::io::Cursor::new(
            "{\"type\":\"control_request\",\"request\":{\"type\":\"can_use_tool\"}}\n",
        ));
        assert!(request_action(&output).is_err());
    }
    fn request_action(output: &mpsc::Receiver<Result<Value, String>>) -> Result<Value, String> {
        request(&mut Vec::new(), output, "usage", "get_usage_info")
    }
}
