use p256::ecdsa::signature::{Signer, Verifier};
use p256::ecdsa::{SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

const STORAGE_FOLDER: &str = "personal-ai-os";
const KEY_FILE_NAME: &str = "device_identity.enc";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DevicePublicKeyJwk {
    pub kty: String,
    pub crv: String,
    pub x: String,
    pub y: String,
}

#[derive(Debug, Deserialize)]
struct LegacyJwk {
    kty: String,
    crv: String,
    #[serde(default)]
    x: String,
    #[serde(default)]
    y: String,
    #[serde(default)]
    d: String,
}

fn base64_url_encode(data: &[u8]) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    URL_SAFE_NO_PAD.encode(data)
}

fn base64_url_decode(data: &str) -> Result<Vec<u8>, String> {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    // Tolerate padding if present
    let clean = data.trim_end_matches('=');
    URL_SAFE_NO_PAD
        .decode(clean)
        .map_err(|e| format!("Base64URL decode error: {e}"))
}

fn base64_standard_encode(data: &[u8]) -> String {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;
    STANDARD.encode(data)
}

/// Resolves path to `%APPDATA%\personal-ai-os\device_identity.enc` on Windows,
/// or fallback to local directory for testing/unix.
fn get_keystore_path() -> PathBuf {
    if let Ok(app_data) = std::env::var("APPDATA") {
        let dir = Path::new(&app_data).join(STORAGE_FOLDER);
        let _ = fs::create_dir_all(&dir);
        dir.join(KEY_FILE_NAME)
    } else if let Ok(home) = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")) {
        let dir = Path::new(&home).join(".personal-ai-os");
        let _ = fs::create_dir_all(&dir);
        dir.join(KEY_FILE_NAME)
    } else {
        PathBuf::from(KEY_FILE_NAME)
    }
}

/// Windows DPAPI implementation: encrypts data using current Windows user login master key.
#[cfg(windows)]
fn dpapi_protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_PROMPTSTRUCT, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: plaintext.len() as u32,
        pbData: plaintext.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let success = unsafe {
        CryptProtectData(
            &in_blob,
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null::<CRYPTPROTECT_PROMPTSTRUCT>(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };

    if success == 0 {
        return Err(format!(
            "CryptProtectData gagal: error code {}",
            std::io::Error::last_os_error()
        ));
    }

    let ciphertext = unsafe {
        std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
    };
    unsafe {
        LocalFree(out_blob.pbData as _);
    }
    Ok(ciphertext)
}

#[cfg(not(windows))]
fn dpapi_protect(plaintext: &[u8]) -> Result<Vec<u8>, String> {
    // Non-windows test fallback: simple obfuscation marker
    let mut out = vec![0xFE, 0xED];
    out.extend_from_slice(plaintext);
    Ok(out)
}

/// Windows DPAPI implementation: decrypts data using current Windows user login master key.
#[cfg(windows)]
fn dpapi_unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr::null_mut;
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_PROMPTSTRUCT, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN,
    };

    let in_blob = CRYPT_INTEGER_BLOB {
        cbData: ciphertext.len() as u32,
        pbData: ciphertext.as_ptr() as *mut u8,
    };
    let mut out_blob = CRYPT_INTEGER_BLOB {
        cbData: 0,
        pbData: null_mut(),
    };

    let success = unsafe {
        CryptUnprotectData(
            &in_blob,
            null_mut(),
            std::ptr::null(),
            std::ptr::null(),
            std::ptr::null::<CRYPTPROTECT_PROMPTSTRUCT>(),
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut out_blob,
        )
    };

    if success == 0 {
        return Err(format!(
            "CryptUnprotectData gagal: error code {}",
            std::io::Error::last_os_error()
        ));
    }

    let plaintext = unsafe {
        std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
    };
    unsafe {
        LocalFree(out_blob.pbData as _);
    }
    Ok(plaintext)
}

#[cfg(not(windows))]
fn dpapi_unprotect(ciphertext: &[u8]) -> Result<Vec<u8>, String> {
    if ciphertext.len() >= 2 && ciphertext[0] == 0xFE && ciphertext[1] == 0xED {
        Ok(ciphertext[2..].to_vec())
    } else {
        Err("Invalid ciphertext format".to_string())
    }
}

pub struct SecureDeviceKeystore {
    key_path: PathBuf,
    cached_signing_key: RwLock<Option<SigningKey>>,
}

impl SecureDeviceKeystore {
    pub fn new() -> Self {
        Self {
            key_path: get_keystore_path(),
            cached_signing_key: RwLock::new(None),
        }
    }

    #[cfg(test)]
    pub fn with_custom_path(path: PathBuf) -> Self {
        Self {
            key_path: path,
            cached_signing_key: RwLock::new(None),
        }
    }

    pub fn has_key(&self) -> bool {
        if self.cached_signing_key.read().unwrap().is_some() {
            return true;
        }
        self.key_path.exists()
    }

    fn to_public_jwk(verifying_key: &VerifyingKey) -> DevicePublicKeyJwk {
        let point = verifying_key.to_encoded_point(false);
        let x_bytes = point.x().expect("valid x coordinate");
        let y_bytes = point.y().expect("valid y coordinate");

        DevicePublicKeyJwk {
            kty: "EC".to_string(),
            crv: "P-256".to_string(),
            x: base64_url_encode(x_bytes),
            y: base64_url_encode(y_bytes),
        }
    }

    fn save_signing_key_to_disk(&self, signing_key: &SigningKey) -> Result<(), String> {
        let secret_bytes = signing_key.to_bytes();
        let encrypted = dpapi_protect(&secret_bytes)?;
        if let Some(parent) = self.key_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        fs::write(&self.key_path, encrypted)
            .map_err(|e| format!("Gagal menyimpan kunci terenkripsi ke disk: {e}"))?;
        Ok(())
    }

    pub fn load_or_create_signing_key(&self) -> Result<SigningKey, String> {
        // 1. Check memory cache first
        if let Some(key) = self.cached_signing_key.read().unwrap().as_ref() {
            return Ok(key.clone());
        }

        // 2. Load from disk if exists
        if self.key_path.exists() {
            let encrypted = fs::read(&self.key_path)
                .map_err(|e| format!("Gagal membaca file kunci: {e}"))?;
            let decrypted = dpapi_unprotect(&encrypted)?;
            let signing_key = SigningKey::from_slice(&decrypted)
                .map_err(|e| format!("Kunci yang tersimpan tidak valid: {e}"))?;

            let mut lock = self.cached_signing_key.write().unwrap();
            *lock = Some(signing_key.clone());
            return Ok(signing_key);
        }

        // 3. Generate fresh P-256 key pair
        let mut rng = rand_core::OsRng;
        let signing_key = SigningKey::random(&mut rng);
        self.save_signing_key_to_disk(&signing_key)?;

        let mut lock = self.cached_signing_key.write().unwrap();
        *lock = Some(signing_key.clone());
        Ok(signing_key)
    }

    pub fn get_public_key(&self) -> Result<DevicePublicKeyJwk, String> {
        let signing_key = self.load_or_create_signing_key()?;
        let verifying_key = signing_key.verifying_key();
        Ok(Self::to_public_jwk(verifying_key))
    }

    /// Signs challenge using ECDSA P-256 SHA-256. Emits 64-byte raw (r || s) Base64 encoded signature.
    pub fn sign_challenge(&self, challenge: &str) -> Result<String, String> {
        let signing_key = self.load_or_create_signing_key()?;
        let signature: p256::ecdsa::Signature = signing_key.sign(challenge.as_bytes());
        let raw_signature_bytes = signature.to_bytes();
        Ok(base64_standard_encode(&raw_signature_bytes))
    }

    /// One-time migration of legacy JWK from localStorage into Rust secure DPAPI storage.
    pub fn migrate_legacy_jwk(&self, jwk_json: &str) -> Result<DevicePublicKeyJwk, String> {
        let legacy: LegacyJwk = serde_json::from_str(jwk_json)
            .map_err(|e| format!("Format JWK lama tidak valid: {e}"))?;

        if legacy.kty != "EC" || legacy.crv != "P-256" {
            return Err("Kunci lama bukan kurva EC P-256".to_string());
        }
        if legacy.d.is_empty() {
            return Err("JWK lama tidak memuat private member 'd'".to_string());
        }

        let d_bytes = base64_url_decode(&legacy.d)?;
        let signing_key = SigningKey::from_slice(&d_bytes)
            .map_err(|e| format!("Private scalar 'd' tidak valid: {e}"))?;

        self.save_signing_key_to_disk(&signing_key)?;

        let verifying_key = signing_key.verifying_key();
        let public_jwk = Self::to_public_jwk(verifying_key);

        let mut lock = self.cached_signing_key.write().unwrap();
        *lock = Some(signing_key);

        Ok(public_jwk)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Verifier;

    #[test]
    fn test_generate_and_sign_matches_p256_verification() {
        let temp_dir = std::env::temp_dir().join(format!("test_keystore_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let key_file = temp_dir.join("test_device.enc");

        let keystore = SecureDeviceKeystore::with_custom_path(key_file.clone());

        let pub_key = keystore.get_public_key().expect("must get public key");
        assert_eq!(pub_key.kty, "EC");
        assert_eq!(pub_key.crv, "P-256");
        assert!(!pub_key.x.is_empty());
        assert!(!pub_key.y.is_empty());

        let challenge = "device-handshake:test-nonce-12345";
        let sig_base64 = keystore.sign_challenge(challenge).expect("must sign challenge");

        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;
        let sig_bytes = STANDARD.decode(&sig_base64).expect("valid base64");
        assert_eq!(sig_bytes.len(), 64, "Raw signature must be exactly 64 bytes (r || s)");

        let x_bytes = base64_url_decode(&pub_key.x).expect("valid x");
        let y_bytes = base64_url_decode(&pub_key.y).expect("valid y");
        let mut encoded = vec![0x04];
        encoded.extend_from_slice(&x_bytes);
        encoded.extend_from_slice(&y_bytes);

        let verifying_key = VerifyingKey::from_sec1_bytes(&encoded).expect("valid sec1 public key");
        let signature = p256::ecdsa::Signature::from_slice(&sig_bytes).expect("valid signature");

        assert!(
            verifying_key.verify(challenge.as_bytes(), &signature).is_ok(),
            "Signature verification must succeed"
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_migrate_legacy_jwk() {
        let temp_dir = std::env::temp_dir().join(format!("test_keystore_mig_{}", std::process::id()));
        let _ = fs::create_dir_all(&temp_dir);
        let key_file = temp_dir.join("test_device_mig.enc");

        let keystore = SecureDeviceKeystore::with_custom_path(key_file.clone());

        let legacy_jwk = r#"{
            "kty": "EC",
            "crv": "P-256",
            "x": "W85k89VjHspE0RkWnE4_5Z6EaV5f2zS6F9o2q8v9Q0g",
            "y": "xQ3A2W8N7v7u6T5S4R3Q2P1O0N9M8L7K6J5I4H3G2F1",
            "d": "1v3_5w7y9A1C3E5G7I9K1M3O5Q7S9U1W3Y5a7c9e1g0"
        }"#;

        let migrated = keystore.migrate_legacy_jwk(legacy_jwk).expect("must migrate legacy key");
        assert_eq!(migrated.kty, "EC");
        assert_eq!(migrated.crv, "P-256");

        assert!(keystore.has_key());

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
