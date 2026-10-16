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
    #[error("Command execution timed out after {0} ms")]
    ExecutionTimeout(u64),
    #[error("COMMAND_NOT_ALLOWED ({1}): \"{0}\" is not on the local command allowlist")]
    CommandNotAllowed(String, &'static str),
}

impl SecurityError {
    /// The wire code the Windows agent reports; the human-readable detail is in `Display`.
    pub fn code(&self) -> &'static str {
        match self {
            SecurityError::PathOutsideAllowlist(_) => "PATH_OUTSIDE_ALLOWLIST",
            SecurityError::PathTraversal(_) => "PATH_TRAVERSAL",
            SecurityError::InvalidPathFormat(_) => "INVALID_PATH_FORMAT",
            SecurityError::ExecutionTimeout(_) => "EXECUTION_TIMEOUT",
            SecurityError::CommandNotAllowed(_, _) => "COMMAND_NOT_ALLOWED",
        }
    }
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

        // 0. Reject Null Bytes
        if path_str.contains('\0') {
            return Err(SecurityError::InvalidPathFormat(path_str.to_string()));
        }

        // 1. Reject Alternate Data Streams (e.g., file.txt:secret, C:\dir:stream, C:\file::$DATA)
        // On Windows, the ONLY valid colon is at index 1 following an ASCII drive letter (e.g. C:\ or C:/).
        let has_invalid_colon = path_str.chars().enumerate().any(|(i, c)| {
            if c == ':' {
                if i != 1 {
                    return true;
                }
                let first_char = path_str.chars().next().unwrap_or('\0');
                if !first_char.is_ascii_alphabetic() {
                    return true;
                }
            }
            false
        });
        if has_invalid_colon {
            return Err(SecurityError::InvalidPathFormat(path_str.to_string()));
        }

        // 2. Reject Device Namespaces (e.g. \\.\ or \\?\) and UNC paths (e.g. \\server\share)
        if path_str.starts_with(r"\\") {
            return Err(SecurityError::InvalidPathFormat(path_str.to_string()));
        }

        // 3. Reject Traversal components (ParentDir / ..) and URL-encoded traversal
        let lowered = path_str.to_ascii_lowercase();
        if lowered.contains("%2e%2e") || lowered.contains("%2e") {
            return Err(SecurityError::PathTraversal(path_str.to_string()));
        }

        for comp in candidate.components() {
            if let Component::ParentDir = comp {
                return Err(SecurityError::PathTraversal(path_str.to_string()));
            }
        }

        // 4. Reject trailing dots/spaces that Windows Win32 API strips/normalizes
        if path_str.ends_with('.') || path_str.ends_with(' ') {
            return Err(SecurityError::InvalidPathFormat(path_str.to_string()));
        }

        Ok(())
    }

    pub fn is_path_allowed(&self, candidate: &Path) -> Result<PathBuf, SecurityError> {
        self.validate_safe_path(candidate)?;

        let target = if candidate.exists() {
            dunce::canonicalize(candidate).map_err(|_| {
                SecurityError::PathOutsideAllowlist(candidate.to_string_lossy().to_string())
            })?
        } else {
            let parent = candidate.parent().ok_or_else(|| {
                SecurityError::PathOutsideAllowlist(candidate.to_string_lossy().to_string())
            })?;
            let canonical_parent = dunce::canonicalize(parent).map_err(|_| {
                SecurityError::PathOutsideAllowlist(candidate.to_string_lossy().to_string())
            })?;
            canonical_parent.join(candidate.file_name().ok_or_else(|| {
                SecurityError::PathOutsideAllowlist(candidate.to_string_lossy().to_string())
            })?)
        };

        let roots = self.allowed_roots.read().unwrap();
        if roots.iter().any(|root| target.starts_with(root)) {
            Ok(target)
        } else {
            Err(SecurityError::PathOutsideAllowlist(
                candidate.to_string_lossy().to_string(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rejects_alternate_data_streams_with_or_without_drive_letter() {
        let manager = PathAllowlistManager::new();
        assert!(matches!(
            manager.validate_safe_path(Path::new("C:\\allowed\\file.txt:secret")),
            Err(SecurityError::InvalidPathFormat(_))
        ));
        assert!(matches!(
            manager.validate_safe_path(Path::new("file.txt:stream")),
            Err(SecurityError::InvalidPathFormat(_))
        ));
        assert!(matches!(
            manager.validate_safe_path(Path::new("C:\\file.txt::$DATA")),
            Err(SecurityError::InvalidPathFormat(_))
        ));
        assert!(matches!(
            manager.validate_safe_path(Path::new("1:\\invalid\\drive")),
            Err(SecurityError::InvalidPathFormat(_))
        ));
    }

    #[test]
    fn test_rejects_unc_and_device_namespaces() {
        let manager = PathAllowlistManager::new();
        assert!(matches!(
            manager.validate_safe_path(Path::new(r"\\attacker\share\payload.exe")),
            Err(SecurityError::InvalidPathFormat(_))
        ));
        assert!(matches!(
            manager.validate_safe_path(Path::new(r"\\.\COM1")),
            Err(SecurityError::InvalidPathFormat(_))
        ));
        assert!(matches!(
            manager.validate_safe_path(Path::new(r"\\?\C:\secret")),
            Err(SecurityError::InvalidPathFormat(_))
        ));
    }

    #[test]
    fn test_rejects_traversal_and_null_bytes() {
        let manager = PathAllowlistManager::new();
        assert!(matches!(
            manager.validate_safe_path(Path::new("C:\\allowed\\..\\..\\windows")),
            Err(SecurityError::PathTraversal(_))
        ));
        assert!(matches!(
            manager.validate_safe_path(Path::new("C:\\allowed\\%2e%2e\\evil")),
            Err(SecurityError::PathTraversal(_))
        ));
        assert!(matches!(
            manager.validate_safe_path(Path::new("C:\\allowed\\file\0.txt")),
            Err(SecurityError::InvalidPathFormat(_))
        ));
        assert!(matches!(
            manager.validate_safe_path(Path::new("C:\\allowed\\trailing.")),
            Err(SecurityError::InvalidPathFormat(_))
        ));
    }

    #[test]
    fn test_accepts_valid_safe_paths() {
        let manager = PathAllowlistManager::new();
        assert!(manager.validate_safe_path(Path::new("C:\\allowed\\workspace\\file.txt")).is_ok());
        assert!(manager.validate_safe_path(Path::new("relative/safe/path.txt")).is_ok());
    }
}
