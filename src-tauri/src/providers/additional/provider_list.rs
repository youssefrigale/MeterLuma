//! Signed provider-list updates. Between app releases, the publisher can move a ready API
//! provider's GET request to another path on the same official host, or replace its extra
//! headers. Request bodies, credential headers, hosts, mappers and local or CLI providers
//! never change without an app update.
use super::catalog::{self, ProviderSpec};
use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};

const LIST_URL: &str = "https://downloads.meterluma.com/providers/list.json";
const SIGNATURE_URL: &str = "https://downloads.meterluma.com/providers/list.json.sig";
/// Public half of `~/.tauri/meterluma-provider-list.key`. Only lists it signed are applied.
const PUBLIC_KEY: &str = "RWRA/kuvBBi2AYICCwo1c/9s93RMzr/vNlgXgDEZbAFilRYdA4MlDsC1";
const MAX_LIST_BYTES: usize = 256 * 1024;
const MAX_SIGNATURE_BYTES: usize = 4 * 1024;
const MAX_ENTRIES: usize = 200;
const MAX_HEADERS: usize = 8;
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);
const RETRY_INTERVAL: Duration = Duration::from_secs(60 * 60);
const RESERVED_HEADERS: [&str; 9] = [
    "accept",
    "authorization",
    "connection",
    "content-length",
    "cookie",
    "host",
    "proxy-authorization",
    "te",
    "transfer-encoding",
];

#[derive(Deserialize)]
struct List {
    schema: u32,
    version: u64,
    #[serde(default)]
    providers: Vec<Entry>,
}
#[derive(Deserialize)]
struct Entry {
    id: String,
    #[serde(default)]
    requests: Vec<RequestPatch>,
    #[serde(default)]
    headers: Option<BTreeMap<String, String>>,
}
#[derive(Deserialize)]
struct RequestPatch {
    key: String,
    url: String,
}

#[derive(Default)]
struct Patch {
    urls: HashMap<String, String>,
    headers: Option<BTreeMap<String, String>>,
}
#[derive(Default)]
struct Overlay {
    version: u64,
    patches: HashMap<String, Patch>,
}
#[derive(Deserialize, Serialize)]
struct Saved {
    list: String,
    signature: String,
}

struct State {
    overlay: Arc<Overlay>,
    checked: Option<(Instant, bool)>,
}

pub(super) struct ProviderList {
    state: tokio::sync::Mutex<State>,
    cache: Option<PathBuf>,
    online: bool,
}

impl ProviderList {
    pub(super) fn new(cache: Option<PathBuf>) -> Self {
        let overlay = cache
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .filter(|bytes| bytes.len() <= MAX_LIST_BYTES * 2)
            .and_then(|bytes| serde_json::from_slice::<Saved>(&bytes).ok())
            .and_then(|saved| accept(saved.list.as_bytes(), &saved.signature, PUBLIC_KEY).ok())
            .unwrap_or_default();
        Self {
            state: tokio::sync::Mutex::new(State {
                overlay: Arc::new(overlay),
                checked: None,
            }),
            cache,
            online: true,
        }
    }

    /// Never downloads a list; tests use it so provider requests stay on their mock servers.
    #[cfg(test)]
    pub(super) fn offline() -> Self {
        Self {
            online: false,
            ..Self::new(None)
        }
    }

    /// The built-in spec with any verified patch applied. Checks for a newer list at most daily,
    /// or hourly after a failed check, and keeps the last verified list when a check fails.
    pub(super) async fn spec(
        &self,
        client: &reqwest::Client,
        builtin: &ProviderSpec,
    ) -> ProviderSpec {
        let mut state = self.state.lock().await;
        let due = state.checked.is_none_or(|(at, succeeded)| {
            at.elapsed()
                >= if succeeded {
                    CHECK_INTERVAL
                } else {
                    RETRY_INTERVAL
                }
        });
        if self.online && due {
            let succeeded = self.check(client, &mut state).await.is_ok();
            state.checked = Some((Instant::now(), succeeded));
        }
        apply(&state.overlay, builtin)
    }

    async fn check(&self, client: &reqwest::Client, state: &mut State) -> Result<(), ()> {
        let Some(list) = download(client, LIST_URL, MAX_LIST_BYTES).await? else {
            return Ok(());
        };
        let signature = download(client, SIGNATURE_URL, MAX_SIGNATURE_BYTES)
            .await?
            .ok_or(())?;
        let signature = String::from_utf8(signature).map_err(|_| ())?;
        let overlay = accept(&list, &signature, PUBLIC_KEY)?;
        let list = String::from_utf8(list).map_err(|_| ())?;
        if adopt(state, overlay) {
            super::super::persist(&self.cache, &Saved { list, signature });
        }
        Ok(())
    }
}

/// Replaces the overlay unless the candidate is older, so replaying an earlier signed list
/// cannot undo a later fix.
fn adopt(state: &mut State, overlay: Overlay) -> bool {
    if overlay.version < state.overlay.version {
        return false;
    }
    state.overlay = Arc::new(overlay);
    true
}

async fn download(
    client: &reqwest::Client,
    url: &str,
    limit: usize,
) -> Result<Option<Vec<u8>>, ()> {
    let mut response = client.get(url).send().await.map_err(|_| ())?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > limit as u64)
    {
        return Err(());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if bytes.len() + chunk.len() > limit {
            return Err(());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(Some(bytes))
}

/// Verifies the minisign signature (the base64 `.sig` format written by `tauri signer sign`)
/// before parsing anything from the list.
fn accept(list: &[u8], signature: &str, key: &str) -> Result<Overlay, ()> {
    let text = base64::engine::general_purpose::STANDARD
        .decode(signature.trim())
        .map_err(|_| ())?;
    let signature =
        Signature::decode(std::str::from_utf8(&text).map_err(|_| ())?).map_err(|_| ())?;
    PublicKey::from_base64(key)
        .and_then(|key| key.verify(list, &signature, false))
        .map_err(|_| ())?;
    overlay(list).map(|(overlay, _)| overlay)
}

/// Parses a list, keeping each provider entry only when every part of it passes the rules.
/// Returns the overlay and the number of rejected entries.
fn overlay(list: &[u8]) -> Result<(Overlay, usize), ()> {
    let list: List = serde_json::from_slice(list).map_err(|_| ())?;
    if list.schema != 1 || list.version == 0 || list.providers.len() > MAX_ENTRIES {
        return Err(());
    }
    let mut overlay = Overlay {
        version: list.version,
        patches: HashMap::new(),
    };
    let mut rejected = 0;
    for entry in &list.providers {
        match patch(entry) {
            Some(patch) if !overlay.patches.contains_key(&entry.id) => {
                overlay.patches.insert(entry.id.clone(), patch);
            }
            _ => rejected += 1,
        }
    }
    Ok((overlay, rejected))
}

fn patch(entry: &Entry) -> Option<Patch> {
    let builtin = catalog::provider(&entry.id).ok()?;
    if builtin.source != "api"
        || builtin.state != "ready"
        || (entry.requests.is_empty() && entry.headers.is_none())
    {
        return None;
    }
    let mut urls = HashMap::new();
    for request in &entry.requests {
        let endpoint = builtin
            .requests
            .iter()
            .find(|endpoint| endpoint.key == request.key)?;
        if endpoint.body.is_some() || !same_host_url(&endpoint.url, &request.url) {
            return None;
        }
        if urls
            .insert(request.key.clone(), request.url.clone())
            .is_some()
        {
            return None;
        }
    }
    let headers = match &entry.headers {
        Some(headers) if headers.len() > MAX_HEADERS => return None,
        Some(headers)
            if !headers
                .iter()
                .all(|(name, value)| allowed_header(name, value, &builtin.auth_header)) =>
        {
            return None
        }
        headers => headers.clone(),
    };
    Some(Patch { urls, headers })
}

fn same_host_url(builtin: &str, candidate: &str) -> bool {
    let (Ok(original), Ok(url)) = (reqwest::Url::parse(builtin), reqwest::Url::parse(candidate))
    else {
        return false;
    };
    candidate.len() <= 2048
        && url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && url.fragment().is_none()
        && url.host_str().is_some()
        && url.host_str() == original.host_str()
        && placeholders(candidate) == placeholders(builtin)
}

fn placeholders(url: &str) -> BTreeSet<&str> {
    url.split('{')
        .skip(1)
        .filter_map(|part| part.split_once('}').map(|(name, _)| name))
        .collect()
}

fn allowed_header(name: &str, value: &str, credential_header: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        && !RESERVED_HEADERS.contains(&lower.as_str())
        && !lower.eq_ignore_ascii_case(credential_header)
        && (1..=200).contains(&value.len())
        && value
            .bytes()
            .all(|byte| (0x20..=0x7e).contains(&byte) && byte != b'{')
}

fn apply(overlay: &Overlay, builtin: &ProviderSpec) -> ProviderSpec {
    let mut spec = builtin.clone();
    if let Some(patch) = overlay.patches.get(&spec.id) {
        for endpoint in &mut spec.requests {
            if let Some(url) = patch.urls.get(&endpoint.key) {
                endpoint.url = url.clone();
            }
        }
        if let Some(headers) = &patch.headers {
            spec.headers = headers.clone();
        }
    }
    spec
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Throwaway key that signed the fixtures below; it is trusted only by these tests.
    const TEST_KEY: &str = "RWTY2VcsM0hdEvo47oiqKQY2hzytS/CoCRyRhG/JBLzFGnA22VylBuc3";
    const FIXTURE: &[u8] = include_bytes!("testdata/provider-list.json");
    const FIXTURE_SIGNATURE: &str = include_str!("testdata/provider-list.json.sig");

    fn builtin(id: &str) -> &'static ProviderSpec {
        catalog::provider(id).unwrap()
    }
    fn url<'a>(spec: &'a ProviderSpec, key: &str) -> &'a str {
        &spec
            .requests
            .iter()
            .find(|endpoint| endpoint.key == key)
            .unwrap()
            .url
    }

    #[test]
    fn a_signed_list_patches_only_same_host_get_requests_and_safe_headers() {
        let verified = accept(FIXTURE, FIXTURE_SIGNATURE, TEST_KEY).unwrap();
        assert_eq!(verified.version, 3);
        let deepseek = apply(&verified, builtin("deepseek"));
        assert_eq!(
            url(&deepseek, "balance"),
            "https://api.deepseek.com/v2/user/balance"
        );
        assert_eq!(
            deepseek.headers.get("X-Client-Version").map(String::as_str),
            Some("2")
        );
        assert_eq!(deepseek.auth_header, builtin("deepseek").auth_header);
        for id in ["openrouter", "warp", "qoder", "copilot"] {
            let spec = apply(&verified, builtin(id));
            assert_eq!(
                serde_json::to_string(&spec.requests.iter().map(|e| &e.url).collect::<Vec<_>>())
                    .unwrap(),
                serde_json::to_string(
                    &builtin(id)
                        .requests
                        .iter()
                        .map(|e| &e.url)
                        .collect::<Vec<_>>()
                )
                .unwrap(),
                "{id} must keep its built-in requests"
            );
            assert_eq!(
                spec.headers,
                builtin(id).headers,
                "{id} must keep its built-in headers"
            );
        }
        assert_eq!(
            overlay(FIXTURE).unwrap().1,
            5,
            "unsafe and unknown entries are rejected whole"
        );
    }

    #[test]
    fn tampered_lists_and_other_keys_are_refused_before_parsing() {
        let mut tampered = FIXTURE.to_vec();
        let position = tampered.iter().position(|byte| *byte == b'3').unwrap();
        tampered[position] = b'9';
        assert!(accept(&tampered, FIXTURE_SIGNATURE, TEST_KEY).is_err());
        assert!(accept(FIXTURE, FIXTURE_SIGNATURE, PUBLIC_KEY).is_err());
        assert!(accept(FIXTURE, "not a signature", TEST_KEY).is_err());
        assert!(accept(FIXTURE, "", TEST_KEY).is_err());
    }

    #[test]
    fn hosts_ports_credentials_fragments_and_placeholders_cannot_change() {
        let builtin = "https://api.fireworks.ai/v1/accounts/{account_id}/billing/summary";
        assert!(same_host_url(
            builtin,
            "https://api.fireworks.ai/v2/accounts/{account_id}/billing"
        ));
        for candidate in [
            "http://api.fireworks.ai/v1/accounts/{account_id}/billing/summary",
            "https://api.fireworks.ai.example.com/v1/accounts/{account_id}",
            "https://example.com/api.fireworks.ai/{account_id}",
            "https://user@api.fireworks.ai/v1/accounts/{account_id}",
            "https://api.fireworks.ai:8443/v1/accounts/{account_id}",
            "https://api.fireworks.ai/v1/accounts/{account_id}#fragment",
            "https://api.fireworks.ai/v1/accounts/fixed/billing/summary",
            "https://api.fireworks.ai/v1/accounts/{account_id}/{user_id}",
            "not a url",
        ] {
            assert!(!same_host_url(builtin, candidate), "{candidate}");
        }
    }

    #[test]
    fn reserved_credential_and_malformed_headers_are_refused() {
        assert!(allowed_header(
            "X-Github-Api-Version",
            "2026-03-10",
            "Authorization"
        ));
        for (name, value) in [
            ("Authorization", "Bearer other"),
            ("cookie", "session=1"),
            ("Host", "example.com"),
            ("X-API-Key", "other"),
            ("Bad Header", "1"),
            ("X-Empty", ""),
            ("X-Control", "line\nbreak"),
            ("X-Template", "{credential}"),
        ] {
            assert!(!allowed_header(name, value, "X-API-Key"), "{name}");
        }
    }

    #[test]
    fn the_published_list_source_passes_every_rule() {
        let (overlay, rejected) = overlay(include_bytes!(
            "../../../../src/additional/provider-list.json"
        ))
        .unwrap();
        assert!(overlay.version >= 1);
        assert_eq!(
            rejected, 0,
            "every entry in src/additional/provider-list.json must be applicable"
        );
    }

    #[test]
    fn an_offline_list_keeps_built_in_specs_and_never_rolls_back() {
        let list = ProviderList::offline();
        let client = reqwest::Client::new();
        let spec = tauri::async_runtime::block_on(list.spec(&client, builtin("deepseek")));
        assert_eq!(url(&spec, "balance"), url(builtin("deepseek"), "balance"));

        let mut state = State {
            overlay: Arc::default(),
            checked: None,
        };
        assert!(adopt(
            &mut state,
            accept(FIXTURE, FIXTURE_SIGNATURE, TEST_KEY).unwrap()
        ));
        assert!(!adopt(
            &mut state,
            Overlay {
                version: 2,
                patches: HashMap::new()
            }
        ));
        assert_eq!(state.overlay.version, 3);
        assert_eq!(
            url(&apply(&state.overlay, builtin("deepseek")), "balance"),
            "https://api.deepseek.com/v2/user/balance"
        );
        assert!(adopt(
            &mut state,
            Overlay {
                version: 3,
                patches: HashMap::new()
            }
        ));
        assert_eq!(
            url(&apply(&state.overlay, builtin("deepseek")), "balance"),
            url(builtin("deepseek"), "balance")
        );
    }
}
