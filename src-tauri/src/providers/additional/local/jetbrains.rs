use super::*;
use quick_xml::{events::Event, Reader};
use serde_json::Value;
use std::{fs::File, io::Read};

fn options(xml: &str) -> Result<BTreeMap<String, Value>, String> {
    let mut reader = Reader::from_str(xml);
    let mut values = BTreeMap::new();
    loop {
        match reader
            .read_event()
            .map_err(|_| "The IDE quota XML is invalid.")?
        {
            Event::Empty(element) | Event::Start(element)
                if element.name().as_ref() == "option" =>
            {
                let mut attributes = BTreeMap::new();
                for attribute in element.attributes() {
                    let attribute = attribute.map_err(|_| "The IDE quota attribute is invalid.")?;
                    let value = attribute
                        .normalized_value(quick_xml::XmlVersion::Implicit1_0)
                        .map_err(|_| "The IDE quota attribute cannot be decoded.")?;
                    attributes.insert(attribute.key.as_ref().to_string(), value.into_owned());
                }
                if let (Some(name), Some(value)) = (attributes.get("name"), attributes.get("value"))
                {
                    if matches!(name.as_str(), "quotaInfo" | "nextRefill") {
                        let value = serde_json::from_str(value)
                            .map_err(|_| "The IDE quota JSON is invalid.")?;
                        values.insert(name.clone(), value);
                    }
                }
            }
            Event::DocType(_) => {
                return Err("External or custom XML entities are not supported.".into())
            }
            Event::Eof => break,
            _ => (),
        }
    }
    Ok(values)
}
fn ide_folder(name: &str) -> bool {
    [
        "Aqua",
        "AndroidStudio",
        "CLion",
        "DataGrip",
        "DataSpell",
        "GoLand",
        "IdeaIC",
        "IntelliJIdeaCE",
        "IntelliJIdea",
        "PhpStorm",
        "PyCharmCE",
        "PyCharm",
        "Rider",
        "RubyMine",
        "RustRover",
        "WebStorm",
        "Writerside",
    ]
    .iter()
    .any(|prefix| {
        name.strip_prefix(prefix).is_some_and(|version| {
            version.starts_with("20")
                && version.contains('.')
                && version
                    .chars()
                    .all(|character| character.is_ascii_digit() || character == '.')
        })
    })
}
fn latest(root: &Path) -> Result<(PathBuf, i64), String> {
    let entries = std::fs::read_dir(root).map_err(|_| "No JetBrains IDE settings were found.")?;
    let mut latest = None;
    for (index, entry) in entries.take(201).enumerate() {
        if index == 200 {
            return Err("Too many IDE settings directories to inspect safely.".into());
        }
        let entry = entry.map_err(|_| "The IDE settings directory could not be inspected.")?;
        if !entry
            .file_type()
            .map_err(|_| "The IDE settings entry could not be inspected.")?
            .is_dir()
            || !ide_folder(&entry.file_name().to_string_lossy())
        {
            continue;
        }
        let path = entry.path().join("options/AIAssistantQuotaManager2.xml");
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };
        let Some(time) = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .and_then(|time| i64::try_from(time.as_millis()).ok())
        else {
            continue;
        };
        if metadata.is_file() && latest.as_ref().is_none_or(|(_, previous)| time > *previous) {
            latest = Some((path, time));
        }
    }
    latest.ok_or_else(|| {
        "No saved AI Assistant quota was found. Open AI Assistant in your IDE first.".into()
    })
}
fn parse(spec: &ProviderSpec, xml: &str, modified: i64, now: i64) -> Result<Snapshot, String> {
    if !(0..=86_400_000).contains(&now.saturating_sub(modified)) {
        return Err("The saved IDE quota is older than 24 hours or has a future timestamp. Refresh AI Assistant in your IDE.".into());
    }
    let values = options(xml)?;
    let quota = values
        .get("quotaInfo")
        .ok_or("The IDE has not saved an AI Assistant quota.")?;
    let count = |field: &str| {
        quota[field]
            .as_f64()
            .filter(|value| value.is_finite() && (0.0..=SAFE_TOTAL as f64).contains(value))
    };
    let (used, maximum) = (
        count("current").ok_or("Missing IDE quota usage.")?,
        count("maximum")
            .filter(|value| *value > 0.0)
            .ok_or("Missing IDE quota allowance.")?,
    );
    let reset = quota["until"]
        .as_str()
        .or_else(|| values.get("nextRefill")?["next"].as_str())
        .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
        .map(|date| date.timestamp_millis());
    if reset.is_some_and(|reset| reset <= now) {
        return Err(
            "The saved IDE quota window has expired. Refresh AI Assistant in your IDE.".into(),
        );
    }
    let mut snapshot = Snapshot::new(spec);
    snapshot.fetched_at = modified;
    snapshot.cached = true;
    snapshot.warning = true;
    snapshot.metrics.push(crate::providers::Metric {
        label: "Saved IDE allowance".into(),
        used_percent: used / maximum * 100.0,
        reset_at: reset,
        period_minutes: None,
    });
    snapshot.notice=Some("Cached quota from the most recently updated JetBrains IDE, at the file modification time. Refresh AI Assistant in that IDE to update it. Multiple IDE accounts are not combined.".into());
    Ok(snapshot)
}
pub(super) fn snapshot(spec: &ProviderSpec) -> Result<Snapshot, String> {
    let root = dirs::config_dir()
        .ok_or("The IDE configuration directory is unavailable.")?
        .join("JetBrains");
    let (path, modified) = latest(&root)?;
    let mut xml = String::new();
    File::open(path)
        .map_err(|_| "The saved IDE quota could not be opened.")?
        .take(1_048_577)
        .read_to_string(&mut xml)
        .map_err(|_| "The saved IDE quota could not be read.")?;
    if xml.len() > 1_048_576 {
        return Err("The IDE quota file exceeds the read limit.".into());
    }
    parse(spec, &xml, modified, chrono::Utc::now().timestamp_millis())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn escaped_xml_quota_is_cached_at_source_time_and_expired_values_are_rejected() {
        let spec = crate::providers::additional::catalog::provider("jetbrains").unwrap();
        let now = chrono::Utc::now().timestamp_millis();
        let xml="<application><component><option name=\"quotaInfo\" value=\"{&quot;maximum&quot;:1000000,&quot;current&quot;:250000,&quot;available&quot;:750000}\"/></component></application>";
        let snapshot = parse(spec, xml, now - 5000, now).unwrap();
        assert_eq!(snapshot.metrics[0].used_percent, 25.0);
        assert_eq!(snapshot.fetched_at, now - 5000);
        assert!(snapshot.cached && snapshot.warning);
        assert!(parse(spec, xml, now - 86_400_001, now).is_err());
        assert!(parse(spec, xml, now + 1, now).is_err());
        let expired = xml.replace(
            "750000}",
            "750000,&quot;until&quot;:&quot;2020-01-01T00:00:00Z&quot;}",
        );
        assert!(parse(spec, &expired, now, now).is_err());
        assert!(options("<!DOCTYPE x SYSTEM 'file:///private'><application/>").is_err());
        assert!(parse(spec, "<application/>", now, now).is_err());
        assert!(ide_folder("IntelliJIdea2026.2"));
        assert!(!ide_folder("unrelated2026.2"));
    }
}
