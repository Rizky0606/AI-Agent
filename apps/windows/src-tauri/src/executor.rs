use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tokio::process::Command;
use tokio::time::timeout;

use crate::security::SecurityError;

pub const DEFAULT_TIMEOUT_MS: u64 = 30_000;
pub const MAX_OUTPUT_BYTES: usize = 1_048_576; // 1 MB limit

#[derive(Debug, Serialize, Deserialize)]
pub struct CommandOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
    pub duration_ms: u64,
}

pub async fn execute_powershell(
    cmd_text: &str,
    cwd: &PathBuf,
    timeout_ms: Option<u64>,
) -> Result<CommandOutput, SecurityError> {
    let limit_ms = timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS);
    let start = std::time::Instant::now();

    let mut command = Command::new("powershell.exe");
    command
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(cmd_text)
        .current_dir(cwd);

    let execute_future = command.output();

    let output = match timeout(Duration::from_millis(limit_ms), execute_future).await {
        Ok(result) => result.map_err(|e| SecurityError::PathTraversal(e.to_string()))?,
        Err(_) => return Err(SecurityError::ExecutionTimeout(limit_ms)),
    };

    let duration_ms = start.elapsed().as_millis() as u64;

    let mut truncated = false;
    let mut raw_stdout = output.stdout;
    if raw_stdout.len() > MAX_OUTPUT_BYTES {
        raw_stdout.truncate(MAX_OUTPUT_BYTES);
        truncated = true;
    }

    let mut raw_stderr = output.stderr;
    if raw_stderr.len() > MAX_OUTPUT_BYTES {
        raw_stderr.truncate(MAX_OUTPUT_BYTES);
        truncated = true;
    }

    Ok(CommandOutput {
        exit_code: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&raw_stdout).to_string(),
        stderr: String::from_utf8_lossy(&raw_stderr).to_string(),
        truncated,
        duration_ms,
    })
}
