use crate::generated_deck_runtime::DECK_RUNTIME_WARM_FIELDS;
use serde::Deserialize;
use serde_json::Value;
use warm_codec::hex;
use warm_codec::payload::WarmManifest;

pub use crate::generated_deck_runtime::{
    CONTRACT_KEY, SEMANTIC_VERSION_HEX, WARM_CODEC_VERSION_HEX,
};
pub const PROJECTION_INSTANCE_KEY: &str = "deck-runtime-v0.instance";
pub const STREAM_KEY: &str = "deck-runtime-v0.warm";

const RESOLVED_CONTRACT_JSON: &str =
    include_str!("../../../../fixtures/projection-runtime/deck-runtime-v0/resolved-contract.json");

#[derive(Debug, Clone)]
pub struct ContractDefinition {
    pub warm_manifest: WarmManifest,
    pub semantic_version: u64,
    pub warm_codec_version: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedContract {
    lane_manifests: LaneManifests,
    manifest: ManifestIdentity,
    semantic_version: String,
    warm_codec_version: String,
}

#[derive(Debug, Deserialize)]
struct LaneManifests {
    warm: Value,
}

#[derive(Debug, Deserialize)]
struct ManifestIdentity {
    key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WarmIdentityManifest {
    fields: Vec<WarmFieldIdentity>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WarmFieldIdentity {
    dot_path: String,
    field_id: u32,
}

impl ContractDefinition {
    pub fn load_embedded() -> Result<Self, String> {
        let resolved: ResolvedContract = serde_json::from_str(RESOLVED_CONTRACT_JSON)
            .map_err(|error| format!("embedded deck resolved contract is invalid: {error}"))?;

        require_equal(&resolved.manifest.key, CONTRACT_KEY, "manifest.key")?;
        require_equal(
            &resolved.semantic_version,
            SEMANTIC_VERSION_HEX,
            "semanticVersion",
        )?;
        require_equal(
            &resolved.warm_codec_version,
            WARM_CODEC_VERSION_HEX,
            "warmCodecVersion",
        )?;

        let warm_identity: WarmIdentityManifest =
            serde_json::from_value(resolved.lane_manifests.warm.clone()).map_err(|error| {
                format!("embedded deck warm field identities are invalid: {error}")
            })?;
        require_generated_field_identities(&warm_identity.fields)?;
        let warm_manifest: WarmManifest = serde_json::from_value(resolved.lane_manifests.warm)
            .map_err(|error| format!("embedded deck warm manifest is invalid: {error}"))?;
        require_optional_equal(
            warm_manifest.codec.as_deref(),
            "framed-snapshot",
            "laneManifests.warm.codec",
        )?;
        require_optional_equal(
            warm_manifest.contract_key.as_deref(),
            CONTRACT_KEY,
            "laneManifests.warm.contractKey",
        )?;
        require_optional_equal(
            warm_manifest.semantic_version.as_deref(),
            SEMANTIC_VERSION_HEX,
            "laneManifests.warm.semanticVersion",
        )?;
        require_optional_equal(
            warm_manifest.warm_codec_version.as_deref(),
            WARM_CODEC_VERSION_HEX,
            "laneManifests.warm.warmCodecVersion",
        )?;
        if warm_manifest.fields.is_empty() {
            return Err("embedded warm manifest must declare fields".to_string());
        }

        Ok(Self {
            warm_manifest,
            semantic_version: hex::parse_u64_hex(SEMANTIC_VERSION_HEX, "semanticVersion")?,
            warm_codec_version: hex::parse_u64_hex(WARM_CODEC_VERSION_HEX, "warmCodecVersion")?,
        })
    }
}

fn require_equal(actual: &str, expected: &str, label: &str) -> Result<(), String> {
    if actual != expected {
        return Err(format!(
            "embedded {label} mismatch: expected {expected}, got {actual}"
        ));
    }
    Ok(())
}

fn require_optional_equal(actual: Option<&str>, expected: &str, label: &str) -> Result<(), String> {
    match actual {
        Some(actual) => require_equal(actual, expected, label),
        None => Err(format!("embedded {label} is missing")),
    }
}

fn require_generated_field_identities(actual: &[WarmFieldIdentity]) -> Result<(), String> {
    if actual.len() != DECK_RUNTIME_WARM_FIELDS.len() {
        return Err(format!(
            "embedded warm field identity count mismatch: expected {}, got {}",
            DECK_RUNTIME_WARM_FIELDS.len(),
            actual.len()
        ));
    }
    for (index, (actual, expected)) in actual
        .iter()
        .zip(DECK_RUNTIME_WARM_FIELDS.iter())
        .enumerate()
    {
        if actual.dot_path != expected.dot_path || actual.field_id != expected.field_id {
            return Err(format!(
                "embedded warm field identity {index} mismatch: expected {}:{}, got {}:{}",
                expected.dot_path, expected.field_id, actual.dot_path, actual.field_id
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ContractDefinition, CONTRACT_KEY, SEMANTIC_VERSION_HEX, WARM_CODEC_VERSION_HEX};
    use crate::generated_deck_runtime::DECK_RUNTIME_WARM_FIELDS;
    use warm_codec::hex;

    #[test]
    fn embedded_resolved_contract_is_the_only_codec_schema_authority() {
        let contract = ContractDefinition::load_embedded().unwrap();

        assert_eq!(
            contract.warm_manifest.contract_key.as_deref(),
            Some(CONTRACT_KEY)
        );
        assert_eq!(
            contract.semantic_version,
            hex::parse_u64_hex(SEMANTIC_VERSION_HEX, "semanticVersion").unwrap()
        );
        assert_eq!(
            contract.warm_codec_version,
            hex::parse_u64_hex(WARM_CODEC_VERSION_HEX, "warmCodecVersion").unwrap()
        );
        assert!(!contract.warm_manifest.fields.is_empty());
        assert_eq!(
            contract.warm_manifest.fields.len(),
            DECK_RUNTIME_WARM_FIELDS.len()
        );
    }
}
