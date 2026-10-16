use crate::security::SecurityError;

/// Built-in allowlist, deny by default. Mirrors `apps/windows/src/security/command-allowlist.ts`:
/// `hostname` is required by the M4 device-dispatch smoke, the rest are what the repo's own tests
/// exercise.
pub const DEFAULT_ALLOWED_COMMANDS: &[&str] = &[
    "hostname",
    "dir",
    "Get-ChildItem",
    "Get-Date",
    "Write-Output",
    "Start-Sleep",
    "ForEach-Object",
];

/// Shells and script hosts. Refused even when listed, because the program that would really run is
/// hidden inside their arguments and never reaches this check.
const SHELL_WRAPPERS: &[&str] = &[
    "cmd",
    "cmd.exe",
    "powershell",
    "powershell.exe",
    "pwsh",
    "pwsh.exe",
    "wscript",
    "wscript.exe",
    "cscript",
    "cscript.exe",
    "mshta",
    "mshta.exe",
    "rundll32",
    "rundll32.exe",
    "bash",
    "sh",
    "wsl",
];

const DYNAMIC_EXECUTION_TOKENS: &[&str] = &["iex", "invoke-expression"];

/// `3` and `1..50` produce data; they invoke nothing.
fn is_data_expression(token: &str) -> bool {
    let (start, end) = match token.split_once("..") {
        Some((start, end)) => (start, end),
        None => (token, ""),
    };
    start.parse::<u64>().is_ok() && (end.is_empty() || end.parse::<u64>().is_ok())
}

/// A program named by path or by file extension rather than by bare name.
fn is_path_like(token: &str) -> bool {
    let bytes = token.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
        return true;
    }
    if token.starts_with("\\\\") || token.starts_with("./") || token.starts_with(".\\") {
        return true;
    }
    let lowered = token.to_ascii_lowercase();
    [".exe", ".cmd", ".bat", ".com", ".ps1", ".vbs", ".js"]
        .iter()
        .any(|ext| lowered.ends_with(ext))
}

fn unquote(token: &str) -> &str {
    let trimmed = token.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() >= 2)
        || (trimmed.starts_with('\'') && trimmed.ends_with('\'') && trimmed.len() >= 2)
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    }
}

/// Parses the program(s) a PowerShell command text invokes and refuses anything that is not on
/// `allowed_commands`. Conservative by construction: strings are not parsed, so a metacharacter
/// inside a literal is treated as real syntax — that can refuse a legitimate command, never a
/// dangerous one.
pub fn assert_command_allowed(
    command_text: &str,
    allowed_commands: &[String],
) -> Result<(), SecurityError> {
    let text = command_text.trim();
    if text.is_empty() {
        return Err(SecurityError::CommandNotAllowed(
            "<empty>".to_string(),
            "EMPTY_COMMAND",
        ));
    }

    if text.contains('\0') {
        return Err(SecurityError::CommandNotAllowed(
            "<null_byte>".to_string(),
            "NULL_BYTE_DETECTED",
        ));
    }

    // Forms that hide the real program from any per-segment check, so they are refused outright.
    if text.contains("$(")
        || text.contains('`')
        || text.contains('(')
        || text.contains(')')
    {
        return Err(SecurityError::CommandNotAllowed(
            text.to_string(),
            "SUBSHELL",
        ));
    }
    if has_call_operator(text) {
        return Err(SecurityError::CommandNotAllowed(
            text.to_string(),
            "CALL_OPERATOR",
        ));
    }

    let tokens: Vec<&str> = text
        .split(|c: char| c.is_whitespace() || matches!(c, ';' | '|' | '&'))
        .filter(|token| !token.is_empty())
        .collect();

    // `-EncodedCommand` carries the whole script as a blob no per-segment check can read, so it is
    // refused before anything else. `-enc` and longer abbreviations are the ones PowerShell binds
    // to it; shorter ones (`-e`, `-en`) are ambiguous and PowerShell refuses them itself, while
    // `-ea` is `-ErrorAction` and must keep working.
    if let Some(flag) = tokens.iter().find(|token| {
        let lowered = token.to_ascii_lowercase();
        lowered.starts_with("-enc") && "-encodedcommand".starts_with(&lowered)
    }) {
        return Err(SecurityError::CommandNotAllowed(
            flag.to_string(),
            "ENCODED_COMMAND",
        ));
    }

    for token in &tokens {
        let unquoted_token = unquote(token);
        let lowered = unquoted_token.to_ascii_lowercase();
        if DYNAMIC_EXECUTION_TOKENS.contains(&lowered.as_str()) {
            return Err(SecurityError::CommandNotAllowed(
                token.to_string(),
                "DYNAMIC_EXECUTION",
            ));
        }
        if SHELL_WRAPPERS.contains(&lowered.as_str()) {
            return Err(SecurityError::CommandNotAllowed(
                token.to_string(),
                "SHELL_WRAPPER",
            ));
        }
    }

    // Inspect scriptblock { ... } bodies for nested command execution
    if let Some(start_brace) = text.find('{') {
        if let Some(end_brace) = text.rfind('}') {
            if end_brace > start_brace {
                let inner = &text[start_brace + 1..end_brace];
                for inner_segment in inner.split([';', '|', '&', '\r', '\n']) {
                    let trimmed_seg = inner_segment.trim();
                    if trimmed_seg.is_empty() {
                        continue;
                    }
                    let raw_head = trimmed_seg.split_whitespace().next().unwrap_or("");
                    let head = unquote(raw_head);
                    if head.is_empty()
                        || head.starts_with('"')
                        || head.starts_with('\'')
                        || head.starts_with('$')
                        || is_data_expression(head)
                    {
                        continue;
                    }
                    let lowered = head.to_ascii_lowercase();
                    if is_path_like(head) {
                        return Err(SecurityError::CommandNotAllowed(
                            head.to_string(),
                            "PATH_QUALIFIED_COMMAND",
                        ));
                    }
                    if SHELL_WRAPPERS.contains(&lowered.as_str()) {
                        return Err(SecurityError::CommandNotAllowed(
                            head.to_string(),
                            "SHELL_WRAPPER",
                        ));
                    }
                    if !allowed_commands
                        .iter()
                        .any(|allowed| allowed.eq_ignore_ascii_case(head))
                    {
                        return Err(SecurityError::CommandNotAllowed(
                            head.to_string(),
                            "COMMAND_NOT_ALLOWED",
                        ));
                    }
                }
            }
        }
    }

    // A chain is only as safe as its worst segment, so every segment's program is checked.
    for segment in text.split([';', '|', '&', '\r', '\n']) {
        let Some(raw_head) = segment.split_whitespace().next() else {
            continue;
        };
        let head = unquote(raw_head);
        if head.is_empty() || is_data_expression(head) {
            continue;
        }
        let lowered = head.to_ascii_lowercase();
        if is_path_like(head) {
            return Err(SecurityError::CommandNotAllowed(
                head.to_string(),
                "PATH_QUALIFIED_COMMAND",
            ));
        }
        if SHELL_WRAPPERS.contains(&lowered.as_str()) {
            return Err(SecurityError::CommandNotAllowed(
                head.to_string(),
                "SHELL_WRAPPER",
            ));
        }
        if !allowed_commands
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(head))
        {
            return Err(SecurityError::CommandNotAllowed(
                head.to_string(),
                "COMMAND_NOT_ALLOWED",
            ));
        }
    }

    Ok(())
}

/// `&&` is a chain separator, a single `&` is the call operator.
fn has_call_operator(text: &str) -> bool {
    let bytes = text.as_bytes();
    bytes.iter().enumerate().any(|(index, byte)| {
        *byte == b'&'
            && bytes.get(index.wrapping_sub(1)) != Some(&b'&')
            && bytes.get(index + 1) != Some(&b'&')
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_allowlist() -> Vec<String> {
        DEFAULT_ALLOWED_COMMANDS.iter().map(|c| c.to_string()).collect()
    }

    #[test]
    fn allows_hostname_and_the_repo_test_commands() {
        let allowed = default_allowlist();
        for command in [
            "hostname",
            "hostname ",
            "dir",
            "Get-Date",
            "Write-Output \"Hello from Windows Agent\"",
            "1..50 | ForEach-Object { \"Line number $_ output text\" }",
            // `-ea` is `-ErrorAction`, not an abbreviation of `-EncodedCommand`.
            "Get-Date -ea SilentlyContinue",
        ] {
            assert!(
                assert_command_allowed(command, &allowed).is_ok(),
                "{command} should be allowed"
            );
        }
    }

    #[test]
    fn rejects_a_binary_that_is_not_on_the_allowlist() {
        let err = assert_command_allowed("Remove-Item -Recurse C:\\", &default_allowlist())
            .expect_err("must reject");
        assert_eq!(err.code(), "COMMAND_NOT_ALLOWED");
        assert!(err.to_string().contains("Remove-Item"), "{err}");
    }

    #[test]
    fn rejects_every_bypass_form_with_a_named_reason() {
        let allowed = default_allowlist();
        for (command, reason) in [
            ("hostname; Remove-Item -Recurse C:\\", "COMMAND_NOT_ALLOWED"),
            ("hostname && Remove-Item -Recurse C:\\", "COMMAND_NOT_ALLOWED"),
            ("hostname | Remove-Item -Recurse C:\\", "COMMAND_NOT_ALLOWED"),
            ("$(hostname)", "SUBSHELL"),
            ("Write-Output (hostname)", "SUBSHELL"),
            ("hostname `; Remove-Item C:\\`", "SUBSHELL"),
            ("powershell -EncodedCommand aABpAA==", "ENCODED_COMMAND"),
            ("hostname -enc aABpAA==", "ENCODED_COMMAND"),
            ("hostname -encodedc aABpAA==", "ENCODED_COMMAND"),
            ("iex (hostname)", "SUBSHELL"),
            ("Invoke-Expression 'hostname'", "DYNAMIC_EXECUTION"),
            ("cmd /c hostname", "SHELL_WRAPPER"),
            ("cmd.exe /c hostname", "SHELL_WRAPPER"),
            ("powershell.exe -Command hostname", "SHELL_WRAPPER"),
            ("pwsh -Command hostname", "SHELL_WRAPPER"),
            ("wsl hostname", "SHELL_WRAPPER"),
            ("C:\\Windows\\System32\\evil.exe", "PATH_QUALIFIED_COMMAND"),
            ("C:/Windows/System32/evil.exe", "PATH_QUALIFIED_COMMAND"),
            (".\\evil.exe", "PATH_QUALIFIED_COMMAND"),
            ("hostname; .\\evil.exe", "PATH_QUALIFIED_COMMAND"),
            ("\\\\attacker\\share\\evil.exe", "PATH_QUALIFIED_COMMAND"),
            ("& hostname", "CALL_OPERATOR"),
            ("hostname & Remove-Item C:\\", "CALL_OPERATOR"),
            ("1..10 | ForEach-Object { Remove-Item C:\\ }", "COMMAND_NOT_ALLOWED"),
            ("1..10 | ForEach-Object { whoami }", "COMMAND_NOT_ALLOWED"),
            ("\"Remove-Item\" C:\\", "COMMAND_NOT_ALLOWED"),
            ("'Remove-Item' C:\\", "COMMAND_NOT_ALLOWED"),
            ("\"cmd.exe\" /c hostname", "SHELL_WRAPPER"),
            ("hostname\0; whoami", "NULL_BYTE_DETECTED"),
        ] {
            let err = assert_command_allowed(command, &allowed).expect_err(command);
            assert_eq!(err.code(), "COMMAND_NOT_ALLOWED", "{command}");
            assert!(
                err.to_string().contains(reason),
                "{command} should name {reason}, got {err}"
            );
        }
    }

    #[test]
    fn empty_command_is_rejected() {
        assert!(assert_command_allowed("   ", &default_allowlist()).is_err());
    }

    #[test]
    fn allowlist_is_configurable_and_denies_by_default() {
        let narrowed: Vec<String> = vec!["hostname".to_string()];
        assert!(assert_command_allowed("hostname", &narrowed).is_ok());
        assert!(assert_command_allowed("dir", &narrowed).is_err());

        // An empty list allows no command text at all.
        assert!(assert_command_allowed("hostname", &[]).is_err());
    }
}
