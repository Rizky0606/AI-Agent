use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;

use crate::command_allowlist::DEFAULT_ALLOWED_COMMANDS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    Filesystem,
    Powershell,
    Git,
    Browser,
    Screenshot,
    Vscode,
    Docker,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CapabilityConfig {
    pub enabled: bool,
    pub description: String,
    pub requires_explicit_opt_in: bool,
    /// Programs this capability may invoke. Empty means "no command text at all".
    pub allowed_commands: Vec<String>,
}

#[derive(Debug)]
pub struct CapabilityRegistry {
    capabilities: RwLock<HashMap<Capability, CapabilityConfig>>,
}

impl Default for CapabilityRegistry {
    fn default() -> Self {
        let mut map = HashMap::new();
        // RULE: All capabilities are default OFF!
        map.insert(
            Capability::Filesystem,
            CapabilityConfig {
                enabled: false,
                description: "Read, write, and list files inside allowlisted directories".into(),
                requires_explicit_opt_in: false,
                allowed_commands: Vec::new(),
            },
        );
        map.insert(
            Capability::Powershell,
            CapabilityConfig {
                enabled: false,
                description: "Execute scoped PowerShell commands (requires explicit opt-in)".into(),
                requires_explicit_opt_in: true,
                allowed_commands: DEFAULT_ALLOWED_COMMANDS
                    .iter()
                    .map(|name| (*name).to_string())
                    .collect(),
            },
        );
        map.insert(
            Capability::Git,
            CapabilityConfig {
                enabled: false,
                description: "Execute Git version control operations".into(),
                requires_explicit_opt_in: false,
                allowed_commands: Vec::new(),
            },
        );
        map.insert(
            Capability::Browser,
            CapabilityConfig {
                enabled: false,
                description: "Launch and control local browser instance".into(),
                requires_explicit_opt_in: false,
                allowed_commands: Vec::new(),
            },
        );
        map.insert(
            Capability::Screenshot,
            CapabilityConfig {
                enabled: false,
                description: "Capture screenshot of the desktop screen".into(),
                requires_explicit_opt_in: false,
                allowed_commands: Vec::new(),
            },
        );
        map.insert(
            Capability::Vscode,
            CapabilityConfig {
                enabled: false,
                description: "VS Code integration (only if explicitly enabled)".into(),
                requires_explicit_opt_in: true,
                allowed_commands: Vec::new(),
            },
        );
        map.insert(
            Capability::Docker,
            CapabilityConfig {
                enabled: false,
                description: "Docker container control (only if explicitly enabled)".into(),
                requires_explicit_opt_in: true,
                allowed_commands: Vec::new(),
            },
        );

        Self {
            capabilities: RwLock::new(map),
        }
    }
}

impl CapabilityRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_enabled(&self, capability: Capability) -> bool {
        let read = self.capabilities.read().unwrap();
        read.get(&capability).map(|c| c.enabled).unwrap_or(false)
    }

    pub fn set_enabled(&self, capability: Capability, enabled: bool) {
        let mut write = self.capabilities.write().unwrap();
        if let Some(config) = write.get_mut(&capability) {
            config.enabled = enabled;
        }
    }

    pub fn get_all(&self) -> HashMap<Capability, CapabilityConfig> {
        self.capabilities.read().unwrap().clone()
    }

    /// Programs `capability` may invoke. Empty means no command text at all, so an unknown or
    /// unconfigured capability denies everything.
    pub fn allowed_commands(&self, capability: Capability) -> Vec<String> {
        let read = self.capabilities.read().unwrap();
        read.get(&capability)
            .map(|config| config.allowed_commands.clone())
            .unwrap_or_default()
    }

    /// Replaces the local allowlist for `capability`. Only the local UI calls this; nothing that
    /// arrives from the server reaches it.
    pub fn set_allowed_commands(&self, capability: Capability, commands: Vec<String>) {
        let mut write = self.capabilities.write().unwrap();
        if let Some(config) = write.get_mut(&capability) {
            config.allowed_commands = commands;
        }
    }
}
