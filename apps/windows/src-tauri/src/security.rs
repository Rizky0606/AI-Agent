use std::path::{Component, Path, PathBuf};
use std::sync::RwLock;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum SecurityError {
    #[error("Path outside allowlist: '{0}' is not inside any allowed directory")]
    PathOutsideAllowlist(String),
    #[error("Path traversal detected: traversal components are not permitted ('{0}')")]
    PathTraversal(String),
    #[error("Invalid path format: alternate data streams or device namespaces rejected ('{0}')")]
    InvalidPathFormat(String),
    #[error("Capability '{0}' is disabled by user policy")]
    CapabilityDisabled(String),
    #[error("Command execution timed out after {0} ms")]
    ExecutionTimeout(u64),
    #[error("Output exceeded max buffer size ({0} bytes)")]
    OutputBufferExceeded(usize),
}

pub struct PathAllowlistManager {
    allowed_roots: RwLock<Vec<PathBuf>>,
}

impl PathAllowlistManager {
    pub fn new() -> Self {
        Self {
            allowed_roots: RwLock::new(Vec::new()),
        }
    }

    pub fn with_roots(roots: Vec<PathBuf>) -> Self {
        Self {
            allowed_roots: RwLock::new(roots),
        }
    }

    pub fn add_root(&self, path: PathBuf) -> Result<(), SecurityError> {
        self.validate_safe_path(&path)?;
        let canonical = dunce::canonicalize(&path).unwrap_or(path);
        let mut write = self.allowed_roots.write().unwrap();
        if !write.contains(&canonical) {
            write.push(canonical);
        }
        Ok(())
    }

    pub fn remove_root(&self, path: &Path) {
        let mut write = self.allowed_roots.write().unwrap();
        write.retain(|p| p != path);
    }

    pub fn get_roots(&self) -> Vec<PathBuf> {
        self.allowed_roots.read().unwrap().clone()
    }

    pub fn validate_safe_path(&self, candidate: &Path) -> Result<(), SecurityError> {
        let path_str = candidate.to_string_lossy();

        // 1. Reject Alternate Data Streams (e.g., file.txt:secret)
        if path_str.contains(':') && !path_str[1..].starts_with(":\\") && !path_str[1..].starts_with(":/") {
            return Err(SecurityError::InvalidPathFormat(path_str.to_string()));
        }

        // 2. Reject Device Namespaces (e.g. \\.\ or \\?\)
        if path_str.starts_with(r"\\.\") || path_str.starts_with(r"\\?\") {
            return Err(SecurityError::InvalidPathFormat(path_str.to_string()));
        }

        // 3. Reject Traversal components (ParentDir / ..)
        for comp in candidate.components() {
            if let Component::ParentDir = comp {
                return Err(SecurityError::PathTraversal(path_str.to_string()));
            }
        }

        Ok(())
    }

    pub fn is_path_allowed(&self, candidate: &Path) -> Result<PathBuf, SecurityError> {
        self.validate_safe_path(candidate)?;

        let target = if candidate.exists() {
            dunce::canonicalize(candidate).unwrap_or_else(|_| candidate.to_path_buf())
        } else {
            // Normalize path by resolving parent
            candidate.to_path_buf()
        };

        let roots = self.allowed_roots.read().unwrap();
        if roots.is_empty() {
            return Err(SecurityError::PathOutsideAllowlist(
                candidate.to_string_lossy().to_string(),
            ));
        }

        for root in roots.iter() {
            if target.starts_with(root) {
                return Ok(target);
            }
        }

        Err(SecurityError::PathOutsideAllowlist(
            candidate.to_string_lossy().to_string(),
        ))
    }
}
