use super::*;
use rusqlite::{Connection, OpenFlags};

fn rows(path: &Path) -> Result<Vec<(i64, u64)>, rusqlite::Error> {
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    db.busy_timeout(std::time::Duration::from_millis(500))?;
    let cutoff = cutoff()
        .and_hms_opt(0, 0, 0)
        .and_then(|date| date.and_local_timezone(Local).earliest())
        .map(|date| date.timestamp_millis())
        .unwrap_or(0);
    let mut query=db.prepare("SELECT started_at,input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens FROM model_usage WHERE started_at>=?1 ORDER BY started_at DESC LIMIT 100001")?;
    let records = query
        .query_map([cutoff], |row| {
            let timestamp: i64 = row.get(0)?;
            let counts: [i64; 4] = [row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?];
            let [input, output, cached, write] = counts;
            let tokens = input
                .checked_add(output)
                .filter(|total| {
                    *total <= SAFE_TOTAL as i64
                        && counts.iter().all(|count| *count >= 0)
                        && cached
                            .checked_add(write)
                            .is_some_and(|cache| cache <= input)
                })
                .map(|total| total as u64);
            Ok((timestamp, tokens))
        })?
        .take(ROW_LIMIT + 1)
        .map(|row| match row {
            Ok((timestamp, Some(tokens))) => (timestamp, tokens),
            _ => (0, u64::MAX),
        })
        .collect();
    Ok(records)
}
pub(super) fn totals(root: &Path) -> Result<Totals, String> {
    let paths = files(&root.join("cli/db"), "sqlite")?;
    let mut totals = Totals::default();
    let mut readable = 0;
    let mut count = 0;
    for path in paths {
        let records = match rows(&path) {
            Ok(records) => records,
            Err(_) => {
                totals.partial = true;
                continue;
            }
        };
        readable += 1;
        for (timestamp, tokens) in records {
            count += 1;
            if count > ROW_LIMIT {
                totals.partial = true;
                break;
            }
            if tokens > SAFE_TOTAL || totals.add(timestamp, tokens).is_err() {
                totals.partial = true;
            }
        }
        if count > ROW_LIMIT {
            break;
        }
    }
    if readable == 0 {
        return Err(
            "The local Zcode databases could not be read or have an unsupported usage schema."
                .into(),
        );
    }
    Ok(totals)
}
