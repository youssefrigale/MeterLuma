use super::*;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs::File,
    io::{BufRead, BufReader, Read},
};

pub(super) struct Record {
    pub key: String,
    pub timestamp: i64,
    pub tokens: u64,
}
type Parser = fn(&Value) -> Result<Vec<Record>, ()>;
struct Scan {
    totals: Totals,
    seen: HashMap<String, (i64, u64)>,
    budget: usize,
    readable: usize,
}
impl Scan {
    fn record(&mut self, record: Record) {
        if self.seen.len() >= ROW_LIMIT && !self.seen.contains_key(&record.key) {
            self.totals.partial = true;
            return;
        }
        if let Some((timestamp, previous)) = self.seen.get(&record.key) {
            if *timestamp != record.timestamp {
                self.totals.partial = true;
                return;
            }
            if record.tokens <= *previous {
                return;
            }
            if self
                .totals
                .add(record.timestamp, record.tokens - *previous)
                .is_err()
            {
                self.totals.partial = true;
                return;
            }
        } else if self.totals.add(record.timestamp, record.tokens).is_err() {
            self.totals.partial = true;
            return;
        }
        self.seen
            .insert(record.key, (record.timestamp, record.tokens));
    }
    fn file(&mut self, path: &Path, parser: Parser) {
        let Ok(file) = File::open(path) else {
            self.totals.partial = true;
            return;
        };
        self.readable += 1;
        let mut reader = BufReader::new(file);
        let mut line = Vec::new();
        loop {
            line.clear();
            let limit = self.budget.min(1_048_576) + 1;
            let length = match reader
                .by_ref()
                .take(limit as u64)
                .read_until(b'\n', &mut line)
            {
                Ok(length) => length,
                Err(_) => {
                    self.totals.partial = true;
                    break;
                }
            };
            if length == 0 {
                break;
            }
            if length > self.budget || length > 1_048_576 || self.seen.len() >= ROW_LIMIT {
                self.totals.partial = true;
                self.budget = 0;
                break;
            }
            self.budget -= length;
            if line.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            match serde_json::from_slice(&line)
                .map_err(|_| ())
                .and_then(|record| parser(&record))
            {
                Ok(records) => {
                    for record in records {
                        self.record(record);
                    }
                }
                Err(_) => self.totals.partial = true,
            }
        }
    }
}
pub(super) fn totals(paths: Vec<PathBuf>, parser: Parser) -> Result<Totals, String> {
    let mut scan = Scan {
        totals: Totals::default(),
        seen: HashMap::new(),
        budget: 64 * 1024 * 1024,
        readable: 0,
    };
    for path in paths {
        scan.file(&path, parser);
        if scan.budget == 0 {
            break;
        }
    }
    if scan.readable == 0 {
        return Err("No local usage files could be read.".into());
    }
    Ok(scan.totals)
}
pub(super) fn session_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut pending = vec![(root.to_path_buf(), 0)];
    let mut paths = Vec::new();
    let mut directories = 0;
    while let Some((directory, depth)) = pending.pop() {
        directories += 1;
        if directories > 2000 {
            return Err("Too many session directories to scan safely.".into());
        }
        let entries = std::fs::read_dir(directory)
            .map_err(|_| "The local session directory could not be read.")?;
        for (index, entry) in entries.take(2001).enumerate() {
            if index == 2000 || paths.len() >= 1000 {
                return Err("Too many local session files to scan safely.".into());
            }
            let entry = entry.map_err(|_| "The local session entry could not be read.")?;
            let kind = entry
                .file_type()
                .map_err(|_| "The local session entry could not be inspected.")?;
            if kind.is_dir() {
                if depth >= 8 {
                    return Err(
                        "The local session directory nesting exceeds the scan limit.".into(),
                    );
                }
                pending.push((entry.path(), depth + 1));
            }
            if kind.is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|extension| extension == "jsonl")
            {
                paths.push(entry.path());
            }
        }
    }
    if paths.is_empty() {
        return Err("No recorded session files were found. Use the provider first.".into());
    }
    paths.sort();
    Ok(paths)
}
