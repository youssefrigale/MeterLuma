use std::{
    ffi::c_void,
    sync::{Mutex, MutexGuard},
};

const LOCKED: &str =
    "Saved connection is locked. Open Connections and choose Unlock saved connection.";
static VAULT_ACCESS: Mutex<()> = Mutex::new(());
const SERVICE: &[u8] = b"app.meterluma.desktop.account-tokens-v1";
#[link(name = "Security", kind = "framework")]
extern "C" {
    fn SecKeychainGetUserInteractionAllowed(allowed: *mut u8) -> i32;
    fn SecKeychainSetUserInteractionAllowed(allowed: u8) -> i32;
    fn SecKeychainFindGenericPassword(
        keychain: *const c_void,
        service_len: u32,
        service: *const u8,
        account_len: u32,
        account: *const u8,
        len: *mut u32,
        data: *mut *mut c_void,
        item: *mut *mut c_void,
    ) -> i32;
    fn SecKeychainAddGenericPassword(
        keychain: *const c_void,
        service_len: u32,
        service: *const u8,
        account_len: u32,
        account: *const u8,
        len: u32,
        data: *const c_void,
        item: *mut *mut c_void,
    ) -> i32;
    fn SecKeychainItemModifyAttributesAndData(
        item: *const c_void,
        attributes: *const c_void,
        len: u32,
        data: *const c_void,
    ) -> i32;
    fn SecKeychainItemFreeContent(attributes: *const c_void, data: *mut c_void) -> i32;
    fn SecKeychainItemDelete(item: *const c_void) -> i32;
}
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(value: *const c_void);
}
fn find(account: &str, length: *mut u32, data: *mut *mut c_void, item: *mut *mut c_void) -> i32 {
    unsafe {
        SecKeychainFindGenericPassword(
            std::ptr::null(),
            SERVICE.len() as u32,
            SERVICE.as_ptr(),
            account.len() as u32,
            account.as_ptr(),
            length,
            data,
            item,
        )
    }
}
fn vault_access() -> Result<MutexGuard<'static, ()>, String> {
    VAULT_ACCESS
        .lock()
        .map_err(|_| "Keychain access is unavailable. Restart MeterLuma and try again.".into())
}

struct SilentKeychain {
    previous: u8,
}
impl SilentKeychain {
    fn begin() -> Result<Self, String> {
        let mut previous = 0;
        // The file-based Keychain ignores LAContext's per-query UI restriction.
        // Every vault operation shares VAULT_ACCESS so interactive actions cannot race this scope.
        unsafe {
            if SecKeychainGetUserInteractionAllowed(&mut previous) != 0
                || SecKeychainSetUserInteractionAllowed(0) != 0
            {
                return Err("Keychain could not be read without opening a dialog. Try again in Connections.".into());
            }
        }
        Ok(Self { previous })
    }
}
impl Drop for SilentKeychain {
    fn drop(&mut self) {
        unsafe {
            SecKeychainSetUserInteractionAllowed(self.previous);
        }
    }
}

fn credential_bytes(keychain: *const c_void, account: &str) -> Result<Vec<u8>, String> {
    let mut length = 0;
    let mut credential = std::ptr::null_mut();
    let status = unsafe {
        SecKeychainFindGenericPassword(
            keychain,
            SERVICE.len() as u32,
            SERVICE.as_ptr(),
            account.len() as u32,
            account.as_ptr(),
            &mut length,
            &mut credential,
            std::ptr::null_mut(),
        )
    };
    if status != 0 {
        return Err(match status {
            -25308 | -25315 | -25293 | -128 => LOCKED,
            -25300 => "No saved token. Add a connection in Connections.",
            _ => "The saved connection could not be read from Keychain. Try again in Connections.",
        }
        .into());
    }
    // Security owns the buffer even when its contents fail the size check.
    unsafe {
        let bytes = if (1..=65_536).contains(&length) {
            Ok(std::slice::from_raw_parts(credential.cast::<u8>(), length as usize).to_vec())
        } else {
            Err("The saved token has an invalid size. Replace it in Connections.".into())
        };
        SecKeychainItemFreeContent(std::ptr::null(), credential);
        bytes
    }
}

pub fn read(account: &str) -> Result<Vec<u8>, String> {
    let _access = vault_access()?;
    let _silent = SilentKeychain::begin()?;
    credential_bytes(std::ptr::null(), account)
}

pub fn authorize(account: &str) -> Result<Vec<u8>, String> {
    let _access = vault_access()?;
    credential_bytes(std::ptr::null(), account)
}

pub fn write(account: &str, bytes: &[u8]) -> Result<(), String> {
    let _access = vault_access()?;
    let mut item = std::ptr::null_mut();
    let found = find(
        account,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        &mut item,
    );
    let status = unsafe {
        if found == 0 {
            let status = SecKeychainItemModifyAttributesAndData(
                item,
                std::ptr::null(),
                bytes.len() as u32,
                bytes.as_ptr().cast(),
            );
            CFRelease(item);
            status
        } else if found == -25300 {
            SecKeychainAddGenericPassword(
                std::ptr::null(),
                SERVICE.len() as u32,
                SERVICE.as_ptr(),
                account.len() as u32,
                account.as_ptr(),
                bytes.len() as u32,
                bytes.as_ptr().cast(),
                std::ptr::null_mut(),
            )
        } else {
            found
        }
    };
    if status == 0 {
        Ok(())
    } else {
        Err("Keychain could not save the token. Allow access if asked, then try again.".into())
    }
}
pub fn forget(account: &str) -> Result<(), String> {
    let _access = vault_access()?;
    let mut item = std::ptr::null_mut();
    let found = find(
        account,
        std::ptr::null_mut(),
        std::ptr::null_mut(),
        &mut item,
    );
    if found == -25300 {
        return Ok(());
    }
    if found != 0 {
        return Err(
            "Keychain could not remove the token. Allow access if asked, then try again.".into(),
        );
    }
    let status = unsafe {
        let status = SecKeychainItemDelete(item);
        CFRelease(item);
        status
    };
    if status == 0 {
        Ok(())
    } else {
        Err("The saved token could not be removed from Keychain.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::CString, path::PathBuf, time::Instant};
    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainCreate(
            path: *const i8,
            length: u32,
            password: *const u8,
            prompt: u8,
            access: *const c_void,
            keychain: *mut *const c_void,
        ) -> i32;
        fn SecKeychainLock(keychain: *const c_void) -> i32;
        fn SecKeychainUnlock(
            keychain: *const c_void,
            length: u32,
            password: *const u8,
            use_password: u8,
        ) -> i32;
        fn SecKeychainDelete(keychain: *const c_void) -> i32;
    }
    const PASSWORD: &[u8] = b"synthetic-meterluma-keychain-test";
    const ACCOUNT: &str = "synthetic-keychain-test";
    struct IsolatedKeychain {
        keychain: *const c_void,
        directory: PathBuf,
    }
    impl IsolatedKeychain {
        fn create() -> Self {
            let directory = std::env::temp_dir()
                .join(format!("meterluma-keychain-test-{}", std::process::id()));
            std::fs::create_dir(&directory).unwrap();
            let path =
                CString::new(directory.join("isolated.keychain-db").to_str().unwrap()).unwrap();
            let mut keychain = std::ptr::null();
            assert_eq!(
                unsafe {
                    SecKeychainCreate(
                        path.as_ptr(),
                        PASSWORD.len() as u32,
                        PASSWORD.as_ptr(),
                        0,
                        std::ptr::null(),
                        &mut keychain,
                    )
                },
                0
            );
            Self {
                keychain,
                directory,
            }
        }
    }
    impl Drop for IsolatedKeychain {
        fn drop(&mut self) {
            unsafe {
                SecKeychainDelete(self.keychain);
                CFRelease(self.keychain);
            }
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }
    #[test]
    fn locked_saved_connection_fails_without_prompting_and_can_be_read_after_unlock() {
        let _access = vault_access().unwrap();
        let mut original_interaction = 0;
        assert_eq!(
            unsafe { SecKeychainGetUserInteractionAllowed(&mut original_interaction) },
            0
        );
        let silent = SilentKeychain::begin().unwrap();
        let isolated = IsolatedKeychain::create();
        let fixture = b"synthetic-saved-connection";
        assert_eq!(
            unsafe {
                SecKeychainAddGenericPassword(
                    isolated.keychain,
                    SERVICE.len() as u32,
                    SERVICE.as_ptr(),
                    ACCOUNT.len() as u32,
                    ACCOUNT.as_ptr(),
                    fixture.len() as u32,
                    fixture.as_ptr().cast(),
                    std::ptr::null_mut(),
                )
            },
            0
        );
        assert_eq!(
            credential_bytes(isolated.keychain, ACCOUNT).unwrap(),
            fixture
        );
        assert!(credential_bytes(isolated.keychain, "missing-account")
            .unwrap_err()
            .starts_with("No saved token."));
        assert_eq!(unsafe { SecKeychainLock(isolated.keychain) }, 0);
        let started = Instant::now();
        for _ in 0..3 {
            assert_eq!(
                credential_bytes(isolated.keychain, ACCOUNT).unwrap_err(),
                LOCKED
            );
        }
        assert!(
            started.elapsed().as_secs() < 5,
            "Background reads must not wait for an OS dialog"
        );
        assert_eq!(
            unsafe {
                SecKeychainUnlock(
                    isolated.keychain,
                    PASSWORD.len() as u32,
                    PASSWORD.as_ptr(),
                    1,
                )
            },
            0
        );
        assert_eq!(
            credential_bytes(isolated.keychain, ACCOUNT).unwrap(),
            fixture
        );
        drop(isolated);
        drop(silent);
        let mut restored_interaction = 0;
        assert_eq!(
            unsafe { SecKeychainGetUserInteractionAllowed(&mut restored_interaction) },
            0
        );
        assert_eq!(restored_interaction, original_interaction);
    }
}
