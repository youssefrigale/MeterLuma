use std::io::{Read, Write};
use tauri_plugin_dialog::DialogExt;

const SUPPORT_LIMIT: usize = 65_536;

#[derive(serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SupportKind {
    Preferences,
    Diagnostics,
}
impl SupportKind {
    fn name(&self) -> &'static str {
        match self {
            Self::Preferences => "preferences",
            Self::Diagnostics => "diagnostics",
        }
    }
}
struct Document {
    kind: &'static str,
    format: String,
    content: String,
}

fn write_export(path: &std::path::Path, content: &str) -> Result<(), String> {
    let parent = path.parent().ok_or("Choose a local file for the export.")?;
    let temporary = parent.join(format!(
        ".MeterLuma-export-{}-{}",
        std::process::id(),
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&temporary)
        .map_err(|_| "The export could not be created in this folder.")?;
    // Replace only after a complete write, so a failed save cannot truncate the previous export.
    let written = file
        .write_all(content.as_bytes())
        .and_then(|_| file.sync_all());
    drop(file);
    let saved = written.and_then(|_| std::fs::rename(&temporary, path));
    if saved.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    saved.map_err(|_| "The export could not be saved. The previous file was kept.".into())
}

async fn save_document(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    document: Document,
) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let name = format!(
            "MeterLuma-{}-{}.{}",
            document.kind,
            chrono::Local::now().format("%Y-%m-%d"),
            document.format
        );
        let selected = super::quick::with_dialog(&window, || {
            app.dialog()
                .file()
                .set_parent(&window)
                .set_title(format!("Export MeterLuma {}", document.kind))
                .set_file_name(&name)
                .add_filter("MeterLuma export", &[document.format.as_str()])
                .blocking_save_file()
        });
        let Some(selected) = selected else {
            return Ok(false);
        };
        let path = selected
            .into_path()
            .map_err(|_| "Choose a local file for the export.".to_string())?;
        write_export(&path, &document.content)?;
        Ok(true)
    })
    .await
    .map_err(|_| "The export dialog could not be opened.".to_string())?
}

#[tauri::command]
pub async fn save_usage_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    format: String,
    content: String,
) -> Result<bool, String> {
    if !matches!(format.as_str(), "csv" | "json") || content.len() > 8 * 1024 * 1024 {
        return Err("The export format or size is invalid.".into());
    }
    save_document(
        app,
        window,
        Document {
            kind: "usage",
            format,
            content,
        },
    )
    .await
}

#[tauri::command]
pub async fn save_support_export(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    kind: SupportKind,
    content: String,
) -> Result<bool, String> {
    if content.len() > SUPPORT_LIMIT {
        return Err("The support export exceeds 64 KiB.".into());
    }
    save_document(
        app,
        window,
        Document {
            kind: kind.name(),
            format: "json".into(),
            content,
        },
    )
    .await
}

fn read_preferences(path: &std::path::Path) -> Result<String, String> {
    if !std::fs::metadata(path)
        .map_err(|_| "The preferences file could not be checked.")?
        .is_file()
    {
        return Err("Choose a regular JSON file.".into());
    }
    let file =
        std::fs::File::open(path).map_err(|_| "The preferences file could not be opened.")?;
    let metadata = file
        .metadata()
        .map_err(|_| "The preferences file could not be checked.")?;
    if !metadata.is_file() || metadata.len() > SUPPORT_LIMIT as u64 {
        return Err("Choose a JSON file up to 64 KiB.".into());
    }
    let mut bytes = Vec::new();
    file.take(SUPPORT_LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "The preferences file could not be read.")?;
    if bytes.len() > SUPPORT_LIMIT {
        return Err("The preferences file exceeds 64 KiB.".into());
    }
    String::from_utf8(bytes).map_err(|_| "The preferences file is not UTF-8 JSON.".into())
}

#[tauri::command]
pub async fn open_preferences_import(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = super::quick::with_dialog(&window, || {
            app.dialog()
                .file()
                .set_parent(&window)
                .set_title("Import MeterLuma preferences")
                .add_filter("Preferences JSON", &["json"])
                .blocking_pick_file()
        });
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected
            .into_path()
            .map_err(|_| "Choose a local preferences file.")?;
        read_preferences(&path).map(Some)
    })
    .await
    .map_err(|_| "The import dialog could not be opened.".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selected_preferences_are_bounded_utf8_and_never_rewritten() {
        let root = std::env::temp_dir().join(format!(
            "meterluma-preferences-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&root).unwrap();
        let path = root.join("preferences.json");
        for bytes in [
            br#"{"kind":"MeterLumaPreferences"}"#.to_vec(),
            vec![b' '; SUPPORT_LIMIT],
            vec![b' '; SUPPORT_LIMIT + 1],
            vec![255],
        ] {
            std::fs::write(&path, &bytes).unwrap();
            let read = read_preferences(&path);
            assert_eq!(
                read.is_ok(),
                bytes.len() <= SUPPORT_LIMIT && std::str::from_utf8(&bytes).is_ok()
            );
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
        assert!(read_preferences(&root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn export_replaces_complete_files_and_failed_replacement_preserves_the_destination() {
        let root = std::env::temp_dir().join(format!(
            "meterluma-export-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&root).unwrap();
        let file = root.join("export.json");
        std::fs::write(&file, "previous export").unwrap();
        write_export(&file, "complete replacement").unwrap();
        assert_eq!(
            std::fs::read_to_string(&file).unwrap(),
            "complete replacement"
        );
        let directory = root.join("keep");
        std::fs::create_dir(&directory).unwrap();
        std::fs::write(directory.join("original"), "keep this").unwrap();
        assert!(write_export(&directory, "cannot replace this directory").is_err());
        assert_eq!(
            std::fs::read_to_string(directory.join("original")).unwrap(),
            "keep this"
        );
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 2);
        std::fs::remove_dir_all(root).unwrap();
    }
}
