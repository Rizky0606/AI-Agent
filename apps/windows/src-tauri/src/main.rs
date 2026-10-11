#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod capabilities;
mod executor;
mod security;

use capabilities::{Capability, CapabilityConfig, CapabilityRegistry};
use executor::CommandOutput;
use security::PathAllowlistManager;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::State;

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
            execute_local_command
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
