use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::RwLock;

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
            },
        );
        map.insert(
            Capability::Powershell,
            CapabilityConfig {
                enabled: false,
                description: "Execute scoped PowerShell commands".into(),
                requires_explicit_opt_in: false,
            },
        );
        map.insert(
            Capability::Git,
            CapabilityConfig {
                enabled: false,
                description: "Execute Git version control operations".into(),
                requires_explicit_opt_in: false,
            },
        );
        map.insert(
            Capability::Browser,
            CapabilityConfig {
                enabled: false,
                description: "Launch and control local browser instance".into(),
                requires_explicit_opt_in: false,
            },
        );
        map.insert(
            Capability::Screenshot,
            CapabilityConfig {
                enabled: false,
                description: "Capture screenshot of the desktop screen".into(),
                requires_explicit_opt_in: false,
            },
        );
        map.insert(
            Capability::Vscode,
            CapabilityConfig {
                enabled: false,
                description: "VS Code integration (only if explicitly enabled)".into(),
                requires_explicit_opt_in: true,
            },
        );
        map.insert(
            Capability::Docker,
            CapabilityConfig {
                enabled: false,
                description: "Docker container control (only if explicitly enabled)".into(),
                requires_explicit_opt_in: true,
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
}
