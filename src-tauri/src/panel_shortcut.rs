use std::sync::Mutex;
use tauri::{Manager, State};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[derive(Default)]
pub struct PanelShortcut(Mutex<Option<String>>);

fn valid_shortcut(shortcut: &str) -> bool {
    let parts: Vec<_> = shortcut.split('+').collect();
    parts.len() == 3 && parts[0] == "CommandOrControl" && matches!(parts[1], "Shift" | "Alt")
        && parts[2].len() == 1 && parts[2].as_bytes()[0].is_ascii_uppercase()
}

fn replace_shortcut(
    current: &mut Option<String>, requested: Option<String>,
    register: impl Fn(&str) -> Result<(), String>, unregister: impl Fn(&str) -> Result<(), String>,
) -> Result<Option<String>, String> {
    if *current == requested { return Ok(current.clone()); }
    if let Some(shortcut) = &requested { register(shortcut)?; }
    if let Some(previous) = current.as_deref() {
        if let Err(failure) = unregister(previous) {
            if let Some(shortcut) = &requested {
                unregister(shortcut).map_err(|_| "The shortcut change could not be rolled back. Restart MeterLuma before changing keys again.".to_string())?;
            }
            return Err(failure);
        }
    }
    *current = requested;
    Ok(current.clone())
}

#[tauri::command]
pub async fn set_panel_shortcut(app: tauri::AppHandle, shortcut: Option<String>) -> Result<Option<String>, String> {
    if shortcut.as_deref().is_some_and(|shortcut| !valid_shortcut(shortcut)) { return Err("Choose Command/Ctrl with Shift or Alt and a letter A–Z.".into()); }
    // The plugin dispatches to AppKit and waits; never call it from a synchronous UI-thread command.
    tauri::async_runtime::spawn_blocking(move || {
        let state: State<PanelShortcut> = app.state();
        let mut current = state.0.lock().map_err(|_| "The shortcut setting is unavailable.")?;
        replace_shortcut(&mut current, shortcut,
            |shortcut| app.global_shortcut().register(shortcut).map_err(|_| "This shortcut could not be registered. Choose another combination.".into()),
            |shortcut| app.global_shortcut().unregister(shortcut).map_err(|_| "The previous shortcut could not be released. Try again.".into()))
    }).await.map_err(|_| "The shortcut setting could not be changed.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn shortcuts_require_a_system_modifier_an_extra_modifier_and_one_ascii_letter() {
        for valid in ["CommandOrControl+Shift+A", "CommandOrControl+Alt+Z"] { assert!(valid_shortcut(valid)); }
        for invalid in ["", "A", "Shift+A", "CommandOrControl+A", "CommandOrControl+Shift+", "CommandOrControl+Shift+ab", "CommandOrControl+Shift+é", "CommandOrControl+Shift+1", "CommandOrControl+Shift+M\n", "CommandOrControl+Shift+M+Q"] { assert!(!valid_shortcut(invalid), "{invalid}"); }
    }

    #[test]
    fn shortcut_conflicts_preserve_the_existing_binding_and_replacement_releases_only_the_old_one() {
        let mut current = Some("CommandOrControl+Shift+M".to_string());
        let previous = current.clone();
        let calls = RefCell::new(Vec::new());
        assert!(replace_shortcut(&mut current, Some("CommandOrControl+Alt+K".into()), |_| Err("occupied".into()), |_| panic!("A conflict must keep the previous binding.")).is_err());
        assert_eq!(current, previous);
        let changed = replace_shortcut(&mut current, Some("CommandOrControl+Alt+K".into()), |key| { calls.borrow_mut().push(format!("register:{key}")); Ok(()) }, |key| { calls.borrow_mut().push(format!("unregister:{key}")); Ok(()) }).unwrap();
        assert_eq!(changed.as_deref(), Some("CommandOrControl+Alt+K"));
        assert_eq!(*calls.borrow(), ["register:CommandOrControl+Alt+K", "unregister:CommandOrControl+Shift+M"]);
        replace_shortcut(&mut current, changed, |_| panic!("No duplicate registration."), |_| panic!("No duplicate release.")).unwrap();
        replace_shortcut(&mut current, None, |_| panic!("Removing must not register a key."), |key| { assert_eq!(key, "CommandOrControl+Alt+K"); Ok(()) }).unwrap();
        assert_eq!(current, None);
    }

    #[test]
    fn a_failed_release_rolls_back_the_candidate_and_surfaces_a_failed_rollback() {
        let mut current = Some("old".into());
        let released = RefCell::new(Vec::new());
        let failure = replace_shortcut(&mut current, Some("new".into()), |_| Ok(()), |key| { released.borrow_mut().push(key.to_string()); if key == "old" { Err("release failed".into()) } else { Ok(()) } }).unwrap_err();
        assert_eq!(failure, "release failed"); assert_eq!(current.as_deref(), Some("old")); assert_eq!(*released.borrow(), ["old", "new"]);
        let failure = replace_shortcut(&mut current, Some("new".into()), |_| Ok(()), |_| Err("release failed".into())).unwrap_err();
        assert!(failure.contains("Restart MeterLuma")); assert_eq!(current.as_deref(), Some("old"));
    }
}
