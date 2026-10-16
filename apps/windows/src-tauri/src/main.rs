#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capabilities;
mod command_allowlist;
mod executor;
mod keystore;
mod security;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use capabilities::{Capability, CapabilityConfig, CapabilityRegistry};
use command_allowlist::assert_command_allowed;
use executor::CommandOutput;
use security::PathAllowlistManager;

const MAX_TREE_DEPTH: usize = 32;
const MAX_TREE_ENTRIES: usize = 10_000;
const MAX_TREE_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_READ_BYTES: usize = 1 * 1024 * 1024;
const MAX_WRITE_BYTES: usize = 1 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileTreeEntry {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMetadata {
    pub path: String,
    pub name: String,
    pub kind: String,
    pub size: u64,
    pub readonly: bool,
    pub modified_unix_ms: Option<u128>,
}

fn filesystem_error(message: impl Into<String>) -> String {
    message.into()
}

fn reject_symlink(path: &Path) -> Result<(), String> {
    if fs::symlink_metadata(path)
        .map_err(|e| e.to_string())?
        .file_type()
        .is_symlink()
    {
        return Err(format!("Symlinks are not permitted: '{}'", path.display()));
    }
    Ok(())
}

fn list_tree_recursive(
    path: &Path,
    depth: usize,
    max_depth: usize,
    entries: &mut Vec<FileTreeEntry>,
    output_bytes: &mut usize,
) -> Result<(), String> {
    if entries.len() >= MAX_TREE_ENTRIES {
        return Err(format!("Tree entry limit exceeded ({MAX_TREE_ENTRIES})"));
    }
    reject_symlink(path)?;
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let kind = if metadata.is_dir() { "directory" } else { "file" };
    let name = path.file_name().map(|v| v.to_string_lossy().into_owned()).unwrap_or_default();
    let item = FileTreeEntry { path: path.to_string_lossy().into_owned(), name, kind: kind.into(), size: metadata.len() };
    *output_bytes = output_bytes.saturating_add(item.path.len() + item.name.len() + 32);
    if *output_bytes > MAX_TREE_OUTPUT_BYTES {
        return Err(format!("Tree output limit exceeded ({MAX_TREE_OUTPUT_BYTES} bytes)"));
    }
    entries.push(item);
    if metadata.is_dir() && depth < max_depth {
        let mut children = fs::read_dir(path).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            list_tree_recursive(&child.path(), depth + 1, max_depth, entries, output_bytes)?;
        }
    }
    Ok(())
}

#[tauri::command]
fn list_allowed_tree(path: String, max_depth: Option<usize>, state: State<'_, AppState>) -> Result<Vec<FileTreeEntry>, String> {
    let depth = max_depth.unwrap_or(8);
    if depth > MAX_TREE_DEPTH { return Err(format!("Depth limit exceeded ({MAX_TREE_DEPTH})")); }
    let validated = state.allowlist.is_path_allowed(Path::new(&path)).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    let mut output_bytes = 0;
    list_tree_recursive(&validated, 0, depth, &mut entries, &mut output_bytes)?;
    Ok(entries)
}

#[tauri::command]
fn read_allowed_text(path: String, max_bytes: Option<usize>, state: State<'_, AppState>) -> Result<String, String> {
    let limit = max_bytes.unwrap_or(MAX_READ_BYTES);
    if limit > MAX_READ_BYTES { return Err(format!("Read limit exceeded ({MAX_READ_BYTES} bytes)")); }
    let validated = state.allowlist.is_path_allowed(Path::new(&path)).map_err(|e| e.to_string())?;
    reject_symlink(&validated)?;
    let metadata = fs::metadata(&validated).map_err(|e| e.to_string())?;
    if !metadata.is_file() { return Err("Path is not a file".into()); }
    if metadata.len() > limit as u64 { return Err(format!("File exceeds read limit ({limit} bytes)")); }
    let bytes = fs::read(&validated).map_err(|e| e.to_string())?;
    String::from_utf8(bytes).map_err(|_| "File is not valid UTF-8".into())
}

#[tauri::command]
fn get_allowed_file_metadata(path: String, state: State<'_, AppState>) -> Result<FileMetadata, String> {
    let validated = state.allowlist.is_path_allowed(Path::new(&path)).map_err(|e| e.to_string())?;
    reject_symlink(&validated)?;
    let metadata = fs::metadata(&validated).map_err(|e| e.to_string())?;
    let modified_unix_ms = metadata.modified().ok().and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok()).map(|duration| duration.as_millis());
    Ok(FileMetadata { path: validated.to_string_lossy().into_owned(), name: validated.file_name().map(|v| v.to_string_lossy().into_owned()).unwrap_or_default(), kind: if metadata.is_dir() { "directory" } else if metadata.is_file() { "file" } else { "other" }.into(), size: metadata.len(), readonly: metadata.permissions().readonly(), modified_unix_ms })
}

#[tauri::command]
fn write_allowed_file(path: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    if !state.capabilities.is_enabled(Capability::Filesystem) { return Err("Capability 'Filesystem' is disabled by user policy".into()); }
    if content.len() > MAX_WRITE_BYTES { return Err(format!("Write limit exceeded ({MAX_WRITE_BYTES} bytes)")); }
    let validated = state.allowlist.is_path_allowed(Path::new(&path)).map_err(|e| e.to_string())?;
    if validated.exists() { reject_symlink(&validated)?; }
    fs::write(validated, content).map_err(|e| filesystem_error(e.to_string()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceIdentity {
    pub name: String,
    pub platform: String,
    pub hostname: String,
    pub arch: String,
}

/// Reports what this machine can honestly say about itself. The device id is deliberately absent:
/// the server derives it from the P-256 key the agent signs the handshake challenge with, so an id
/// computed here (it used to be `win-dev-<hostname hash>`) would only be a claim.
#[tauri::command]
fn get_device_identity() -> DeviceIdentity {
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "localhost".to_string());

    DeviceIdentity {
        name: format!("Windows Agent ({})", hostname),
        platform: "windows".to_string(),
        hostname,
        arch: std::env::consts::ARCH.to_string(),
    }
}

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

struct AppState {
    capabilities: Arc<CapabilityRegistry>,
    allowlist: Arc<PathAllowlistManager>,
    close_to_tray: Arc<AtomicBool>,
    keystore: Arc<keystore::SecureDeviceKeystore>,
}

#[tauri::command]
fn get_device_public_key(state: State<'_, AppState>) -> Result<keystore::DevicePublicKeyJwk, String> {
    state.keystore.get_public_key()
}

#[tauri::command]
fn sign_device_challenge(challenge: String, state: State<'_, AppState>) -> Result<String, String> {
    state.keystore.sign_challenge(&challenge)
}

#[tauri::command]
fn migrate_legacy_key(
    jwk_json: String,
    state: State<'_, AppState>,
) -> Result<keystore::DevicePublicKeyJwk, String> {
    state.keystore.migrate_legacy_jwk(&jwk_json)
}

#[tauri::command]
fn has_secure_device_key(state: State<'_, AppState>) -> bool {
    state.keystore.has_key()
}

#[tauri::command]
fn get_capabilities(state: State<'_, AppState>) -> HashMap<Capability, CapabilityConfig> {
    state.capabilities.get_all()
}

#[tauri::command]
fn set_capability(
    capability: Capability,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.capabilities.set_enabled(capability, enabled);
    Ok(())
}

#[tauri::command]
fn get_allowed_commands(capability: Capability, state: State<'_, AppState>) -> Vec<String> {
    state.capabilities.allowed_commands(capability)
}

#[tauri::command]
fn set_allowed_commands(
    capability: Capability,
    commands: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.capabilities.set_allowed_commands(capability, commands);
    Ok(())
}

#[tauri::command]
fn get_allowed_paths(state: State<'_, AppState>) -> Vec<String> {
    state
        .allowlist
        .get_roots()
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

#[tauri::command]
fn add_allowed_path(path: String, state: State<'_, AppState>) -> Result<(), String> {
    state
        .allowlist
        .add_root(PathBuf::from(path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_allowed_path(path: String, state: State<'_, AppState>) -> Result<(), String> {
    state.allowlist.remove_root(&PathBuf::from(path));
    Ok(())
}

#[tauri::command]
async fn execute_local_command(
    capability: Capability,
    command: String,
    cwd: String,
    timeout_ms: Option<u64>,
    state: State<'_, AppState>,
) -> Result<CommandOutput, String> {
    // 1. Verify capability is enabled
    if !state.capabilities.is_enabled(capability) {
        return Err(format!("Capability '{:?}' is disabled by user policy", capability));
    }

    // 2. Verify the command text only invokes programs on the local allowlist
    assert_command_allowed(&command, &state.capabilities.allowed_commands(capability))
        .map_err(|e| format!("{}: {}", e.code(), e))?;

    // 3. Verify CWD is within allowlist
    let cwd_path = PathBuf::from(&cwd);
    let validated_cwd = state
        .allowlist
        .is_path_allowed(&cwd_path)
        .map_err(|e| e.to_string())?;

    // 4. Execute
    executor::execute_powershell(&command, &validated_cwd, timeout_ms)
        .await
        .map_err(|e| e.to_string())
}
/// How long the loopback listener waits for the browser to come back before giving up.
const GOOGLE_LOGIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// Waits for exactly one request on the loopback listener, answers it with a static page, and
/// returns the raw query string of the request target (`code=...&state=...`). The socket read is
/// what blocks; there is no polling loop and no sleep.
async fn read_loopback_query(listener: &tokio::net::TcpListener) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let (mut socket, _peer) = listener
        .accept()
        .await
        .map_err(|error| format!("Loopback accept failed: {error}"))?;

    let mut request = Vec::new();
    let mut buffer = [0u8; 1024];
    loop {
        let read = socket
            .read(&mut buffer)
            .await
            .map_err(|error| format!("Loopback read failed: {error}"))?;
        if read == 0 {
            break;
        }
        request.extend_from_slice(&buffer[..read]);
        // Request line + headers is all we need; stop at the blank line (or a sane cap).
        if request.windows(4).any(|window| window == b"\r\n\r\n") || request.len() > 8192 {
            break;
        }
    }

    let request_line = String::from_utf8_lossy(&request);
    let target = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = target
        .split_once('?')
        .map(|(_, query)| query.to_string())
        .filter(|query| !query.is_empty())
        .ok_or_else(|| "Malformed loopback request: no query string".to_string())?;

    let body = "<!doctype html><meta charset=\"utf-8\"><title>Login selesai</title>\
        <body style=\"font-family:system-ui;padding:48px\"><h1>Login selesai</h1>\
        <p>Kamu bisa menutup tab ini dan kembali ke aplikasi.</p>";
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    socket
        .write_all(response.as_bytes())
        .await
        .map_err(|error| format!("Loopback write failed: {error}"))?;
    let _ = socket.flush().await;

    Ok(query)
}

/// The `cmd` command line that opens `url` in the default browser.
///
/// `cmd` treats an unquoted `&` as a command separator, so an unquoted start URL loses every
/// query parameter after the first one — which is how `code_challenge` and `state` used to vanish
/// and the API answered `VALIDATION_ERROR`. The leading `""` is the window title `start` expects;
/// without it the URL itself would be consumed as the title.
fn browser_command_line(url: &str) -> String {
    format!("start \"\" \"{url}\"")
}

#[cfg(windows)]
fn open_in_browser(url: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // Rust escapes embedded quotes when it builds a Windows command line, which would turn the
    // quotes above into `\"` and hand `cmd` a broken argument, so the line is appended verbatim.
    std::process::Command::new("cmd")
        .arg("/C")
        .raw_arg(browser_command_line(url))
        .spawn()
        .map(|_child| ())
        .map_err(|error| format!("Could not open the browser: {error}"))
}

#[cfg(not(windows))]
fn open_in_browser(_url: &str) -> Result<(), String> {
    Err("Browser opening is only supported on Windows".into())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Hanya URL http:// dan https:// yang diizinkan".into());
    }
    open_in_browser(&url)
}

/// Runs the browser half of the Authorization Code + PKCE flow: binds a loopback port, hands the
/// browser a start URL with `{redirect_uri}` filled in, and returns the raw query the server
/// redirected back with.
#[tauri::command]
async fn google_login(start_url_template: String) -> Result<String, String> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("Could not bind the loopback port: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("Could not read the loopback address: {error}"))?
        .port();
    if !start_url_template.contains("{redirect_uri}") {
        return Err("Start URL template is missing the {redirect_uri} placeholder".into());
    }
    let redirect_uri = format!("http://127.0.0.1:{port}/auth");
    let url = start_url_template.replace("{redirect_uri}", &redirect_uri);
    open_in_browser(&url)?;

    listener
        .set_nonblocking(true)
        .map_err(|error| format!("Could not make the loopback listener non-blocking: {error}"))?;
    let listener = tokio::net::TcpListener::from_std(listener)
        .map_err(|error| format!("Could not prepare the loopback listener: {error}"))?;
    tokio::time::timeout(GOOGLE_LOGIN_TIMEOUT, read_loopback_query(&listener))
        .await
        .map_err(|_| {
            format!(
                "Google login timed out after {}s. Try again.",
                GOOGLE_LOGIN_TIMEOUT.as_secs()
            )
        })?
}

#[tauri::command]
fn get_close_to_tray(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(state.close_to_tray.load(Ordering::Relaxed))
}

#[tauri::command]
fn set_close_to_tray(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    state.close_to_tray.store(enabled, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn get_autostart() -> Result<bool, String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        let output = Command::new("reg")
            .args(["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "PersonalAIOS"])
            .output()
            .map_err(|e| format!("Gagal memeriksa autostart: {e}"))?;
        Ok(output.status.success())
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::process::Command;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_str = exe.to_string_lossy();
        if enabled {
            Command::new("reg")
                .args(["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "PersonalAIOS", "/t", "REG_SZ", "/d", &format!("\"{}\"", exe_str), "/f"])
                .output()
                .map_err(|e| format!("Gagal mengaktifkan autostart: {e}"))?;
        } else {
            Command::new("reg")
                .args(["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "PersonalAIOS", "/f"])
                .output()
                .map_err(|e| format!("Gagal mematikan autostart: {e}"))?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Ok(())
    }
}

fn main() {
    let capabilities = Arc::new(CapabilityRegistry::new());
    let allowlist = Arc::new(PathAllowlistManager::new());
    let close_to_tray = Arc::new(AtomicBool::new(true));
    let close_to_tray_for_event = Arc::clone(&close_to_tray);
    let keystore = Arc::new(keystore::SecureDeviceKeystore::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState {
            capabilities,
            allowlist,
            close_to_tray,
            keystore,
        })
        .on_window_event(move |window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if close_to_tray_for_event.load(Ordering::Relaxed) {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let open_item = MenuItemBuilder::with_id("open", "Buka Personal AI OS").build(app)?;
                let status_item = MenuItemBuilder::with_id("status", "Status: Aktif").enabled(false).build(app)?;
                let quit_item = MenuItemBuilder::with_id("quit", "Keluar").build(app)?;
                let menu = MenuBuilder::new(app)
                    .items(&[&open_item, &status_item, &quit_item])
                    .build()?;

                let mut tray_builder = TrayIconBuilder::new()
                    .menu(&menu)
                    .tooltip("Personal AI OS — Windows Agent")
                    .on_menu_event(|app, event| {
                        match event.id.as_ref() {
                            "open" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                            }
                            "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    });

                if let Some(icon) = app.default_window_icon() {
                    tray_builder = tray_builder.icon(icon.clone());
                }

                let _tray = tray_builder.build(app)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_device_identity,
            get_capabilities,
            set_capability,
            get_allowed_commands,
            set_allowed_commands,
            get_allowed_paths,
            add_allowed_path,
            remove_allowed_path,
            execute_local_command,
            list_allowed_tree,
            read_allowed_text,
            get_allowed_file_metadata,
            write_allowed_file,
            google_login,
            open_external_url,
            get_close_to_tray,
            set_close_to_tray,
            get_autostart,
            set_autostart,
            get_device_public_key,
            sign_device_challenge,
            migrate_legacy_key,
            has_secure_device_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}

#[cfg(test)]
mod tests {
    use super::browser_command_line;

    #[test]
    fn browser_command_line_keeps_every_query_separator_inside_quotes() {
        let url = "https://ai.ojixx.my.id/v1/auth/google/start?redirect_uri=http://127.0.0.1:54810/auth&code_challenge=E9Melhoa&state=verify2";
        let line = browser_command_line(url);

        // Whatever `cmd` sees outside the quoted spans is syntax to it. An unquoted `&` would end
        // the command there, which is exactly the bug this pins.
        let unquoted: String = line.split('"').step_by(2).collect();
        assert!(!unquoted.contains('&'), "unquoted `&` would split the command: {line}");
        assert!(line.starts_with("start \"\" "), "`start` needs the empty title argument: {line}");
        assert!(line.ends_with(&format!("\"{url}\"")), "the URL must be the last quoted argument: {line}");
    }
}
