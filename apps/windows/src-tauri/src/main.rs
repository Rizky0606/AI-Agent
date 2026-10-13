#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capabilities;
mod executor;
mod security;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::State;
use capabilities::{Capability, CapabilityConfig, CapabilityRegistry};
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
    pub id: String,
    pub name: String,
    pub platform: String,
    pub hostname: String,
    pub arch: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
}

#[tauri::command]
fn get_device_identity() -> DeviceIdentity {
    let hostname = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "localhost".to_string());
    let username = std::env::var("USERNAME").unwrap_or_else(|_| "user".to_string());
    let arch = std::env::consts::ARCH.to_string();

    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut hasher = DefaultHasher::new();
    format!("{}-windows-{}-{}", hostname, arch, username).hash(&mut hasher);
    let hash_val = hasher.finish();
    let machine_hash = format!("{:016x}", hash_val);

    DeviceIdentity {
        id: format!("win-dev-{}", machine_hash),
        name: format!("Windows Agent ({})", hostname),
        platform: "windows".to_string(),
        hostname,
        arch,
        public_key: None,
    }
}

struct AppState {
    capabilities: Arc<CapabilityRegistry>,
    allowlist: Arc<PathAllowlistManager>,
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

    // 2. Verify CWD is within allowlist
    let cwd_path = PathBuf::from(&cwd);
    let validated_cwd = state
        .allowlist
        .is_path_allowed(&cwd_path)
        .map_err(|e| e.to_string())?;

    // 3. Execute
    executor::execute_powershell(&command, &validated_cwd, timeout_ms)
        .await
        .map_err(|e| e.to_string())
}

fn main() {
    let capabilities = Arc::new(CapabilityRegistry::new());
    let allowlist = Arc::new(PathAllowlistManager::new());

    tauri::Builder::default()
        .manage(AppState {
            capabilities,
            allowlist,
        })
        .invoke_handler(tauri::generate_handler![
            get_device_identity,
            get_capabilities,
            set_capability,
            get_allowed_paths,
            add_allowed_path,
            remove_allowed_path,
            execute_local_command,
            list_allowed_tree,
            read_allowed_text,
            get_allowed_file_metadata,
            write_allowed_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
