use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn save_usage_export(app: tauri::AppHandle, window: tauri::WebviewWindow, format: String, content: String) -> Result<bool, String> {
    if !matches!(format.as_str(), "csv" | "json") || content.len() > 8 * 1024 * 1024 {
        return Err("The export format or size is invalid.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let name = format!("MeterLuma-usage-{}.{}", chrono::Local::now().format("%Y-%m-%d"), format);
        // Owned by the panel, so it stays above the always-on-top panel and hands focus back when it closes.
        let selected = super::quick::with_dialog(&window, || app.dialog().file().set_parent(&window).set_title("Export MeterLuma usage").set_file_name(&name)
            .add_filter("Usage export", &[format.as_str()]).blocking_save_file());
        let Some(selected) = selected else { return Ok(false); };
        let path = selected.into_path().map_err(|_| "Choose a local file for the export.".to_string())?;
        // Only the path selected in the OS save dialog is writable through this command.
        std::fs::write(path, content).map_err(|_| "The usage export could not be saved.".to_string())?;
        Ok(true)
    }).await.map_err(|_| "The export dialog could not be opened.".to_string())?
}
