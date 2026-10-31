use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSpec {
    pub id: String,
    pub name: String,
    pub state: String,
    pub dashboard: String,
    pub auth_header: String,
    pub requests: Vec<Endpoint>,
    pub source: String,
    #[serde(default)]
    pub credential_scope: Option<CredentialScope>,
    #[serde(default)]
    pub auth_prefix: Option<String>,
    #[serde(default)]
    pub headers: std::collections::BTreeMap<String, String>,
}
#[derive(Clone, Deserialize)]
pub struct CredentialScope {
    pub field: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub key: String,
    pub url: String,
    #[serde(default)]
    pub body: Option<serde_json::Value>,
    #[serde(default)]
    pub body_encoding: BodyEncoding,
    #[serde(default)]
    pub credential_pointer: Option<String>,
}
#[derive(Clone, Copy, Default, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BodyEncoding {
    #[default]
    Json,
    Form,
}

#[cfg(test)]
fn read_only_body(spec: &ProviderSpec, endpoint: &Endpoint) -> bool {
    let Some(body) = &endpoint.body else {
        return true;
    };
    match spec.id.as_str() {
        "alibaba" | "alibaba-cn" => {
            let parameters:serde_json::Value = body["params"].as_str().and_then(|params|serde_json::from_str(params).ok()).unwrap_or_default();
            endpoint.body_encoding == BodyEncoding::Form && parameters["Api"] == "zeldaEasy.broadscope-bailian.codingPlan.queryCodingPlanInstanceInfoV2" && parameters["Data"]["queryCodingPlanInstanceInfoRequest"]["onlyLatestOne"] == true
        },
        "windsurf"|"devin"=>endpoint.url=="https://server.codeium.com/exa.seat_management_pb.SeatManagementService/GetUserStatus",
        "amp"=>endpoint.url=="https://ampcode.com/api/internal" && body==&serde_json::json!({"jsonrpc":"2.0","method":"userDisplayBalanceInfo","params":{},"id":1}),
        "gemini"=>endpoint.url=="https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota" && body==&serde_json::json!({"project":null}),
        "antigravity"=>endpoint.url=="https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary" && body==&serde_json::json!({}),
        "warp"=>endpoint.url=="https://app.warp.dev/graphql/v2?op=GetRequestLimitInfo" && body["operationName"]=="GetRequestLimitInfo" && body["query"].as_str().is_some_and(|query|query.starts_with("query GetRequestLimitInfo(") && !query.contains("mutation")),
        _=>false,
    }
}

pub fn catalog() -> Result<&'static [ProviderSpec], String> {
    static CATALOG: OnceLock<Result<Vec<ProviderSpec>, String>> = OnceLock::new();
    CATALOG
        .get_or_init(|| {
            serde_json::from_str(include_str!("../../../../src/additional/catalog.json"))
                .map_err(|_| "The built-in provider catalog is unavailable.".into())
        })
        .as_ref()
        .map(Vec::as_slice)
        .map_err(Clone::clone)
}
pub fn provider(id: &str) -> Result<&'static ProviderSpec, String> {
    if id.len() > 48 {
        return Err("Unknown additional provider".into());
    }
    catalog()?
        .iter()
        .find(|spec| spec.id == id)
        .ok_or_else(|| "Unknown additional provider".into())
}
pub fn ready(id: &str) -> Result<&'static ProviderSpec, String> {
    let spec = provider(id)?;
    if spec.state != "ready" {
        return Err("This provider's read-only integration is still under review.".into());
    }
    Ok(spec)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn provider_catalog_uses_unique_ids_fixed_https_targets_and_only_known_auth_headers() {
        let specs = catalog().unwrap();
        let mut ids = std::collections::HashSet::new();
        for spec in specs {
            assert!(ids.insert(&spec.id));
            if let Some(scope) = &spec.credential_scope {
                assert!(matches!(
                    scope.field.as_str(),
                    "projectId" | "accountId" | "userId"
                ));
            }
            if spec
                .auth_prefix
                .as_deref()
                .is_some_and(|prefix| prefix.contains("{scope}"))
            {
                assert_eq!(
                    spec.credential_scope
                        .as_ref()
                        .map(|scope| scope.field.as_str()),
                    Some("userId")
                );
                assert_eq!(spec.id, "zed");
            }
            assert!(matches!(
                spec.auth_header.as_str(),
                "" | "Authorization" | "xi-api-key" | "X-API-Key"
            ));
            assert!(spec.dashboard.starts_with("https://"));
            for endpoint in &spec.requests {
                let url = reqwest::Url::parse(&endpoint.url).unwrap();
                assert_eq!(url.scheme(), "https");
                assert!(url.username().is_empty() && url.password().is_none());
                if let Some(pointer) = &endpoint.credential_pointer {
                    assert_eq!(pointer, "/metadata/apiKey");
                    assert!(endpoint
                        .body
                        .as_ref()
                        .and_then(|body| body.pointer(pointer))
                        .is_some_and(serde_json::Value::is_null));
                }
                if endpoint.body.is_some() {
                    assert!(read_only_body(spec, endpoint));
                }
            }
            assert!(matches!(spec.source.as_str(), "api" | "local" | "cli"));
            assert_eq!(
                spec.state == "ready" && spec.source == "api",
                !spec.requests.is_empty()
            );
        }
        for invalid in ["../deepseek", "https://attacker.example", "", "DEEPSEEK"] {
            assert!(ready(invalid).is_err());
        }
    }
}
