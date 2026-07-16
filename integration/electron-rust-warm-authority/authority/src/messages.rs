use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use warm_codec::hex;

pub const CONTROL_ENVELOPE_VERSION: u8 = 1;
pub const SET_TEMPO_RATIO_OPERATION_KEY: &str = "deck.setTempoRatio";
pub const AUTHORITY_KEY: &str = "fixture.deckRuntime.authority";
pub const CONTROL_ENDPOINT_KEY: &str = "deck-runtime-v0.control";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscribeRequestEnvelope {
    pub request_key: String,
    pub request: SubscribeRequest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SubscribeRequest {
    pub contract_key: String,
    pub projection_instance_key: String,
    pub lane: String,
    pub expected_semantic_version: String,
    pub expected_lane_version: String,
}

impl SubscribeRequestEnvelope {
    pub fn validate(&self) -> Result<(), String> {
        require_nonempty(&self.request_key, "requestKey")?;
        require_nonempty(&self.request.contract_key, "request.contractKey")?;
        require_nonempty(
            &self.request.projection_instance_key,
            "request.projectionInstanceKey",
        )?;
        Ok(())
    }

    pub fn expected_versions(&self) -> Result<(u64, u64), String> {
        Ok((
            hex::parse_u64_hex(
                &self.request.expected_semantic_version,
                "request.expectedSemanticVersion",
            )?,
            hex::parse_u64_hex(
                &self.request.expected_lane_version,
                "request.expectedLaneVersion",
            )?,
        ))
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnsubscribeRequestEnvelope {
    pub request_key: String,
    pub request: UnsubscribeRequest,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnsubscribeRequest {
    pub subscription_id: String,
    pub authority_epoch: String,
}

impl UnsubscribeRequestEnvelope {
    pub fn validate(&self) -> Result<(), String> {
        require_nonempty(&self.request_key, "requestKey")?;
        require_nonempty(&self.request.subscription_id, "request.subscriptionId")
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PublicationCredit {
    pub subscription_id: String,
    pub authority_epoch: String,
    pub publication_sequence: String,
}

impl PublicationCredit {
    pub fn validate(&self) -> Result<(), String> {
        require_nonempty(&self.subscription_id, "subscriptionId")
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetricsRequest {
    pub request_key: String,
}

impl MetricsRequest {
    pub fn validate(&self) -> Result<(), String> {
        require_nonempty(&self.request_key, "requestKey")
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ControlRequestEnvelope {
    pub kind: String,
    pub envelope_version: u8,
    pub request_key: String,
    pub operation_key: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetTempoRatioPayload {
    pub authority_epoch: String,
    pub tempo_ratio: f64,
}

impl ControlRequestEnvelope {
    pub fn validate_outer(&self) -> Result<(), String> {
        if self.kind != "control.request" {
            return Err(format!("expected kind control.request, got {}", self.kind));
        }
        if self.envelope_version != CONTROL_ENVELOPE_VERSION {
            return Err(format!(
                "expected envelopeVersion {CONTROL_ENVELOPE_VERSION}, got {}",
                self.envelope_version
            ));
        }
        require_nonempty(&self.request_key, "requestKey")?;
        require_nonempty(&self.operation_key, "operationKey")?;
        if !self.payload.is_object() {
            return Err("payload must be a JSON object".to_string());
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WarmPublicationMetadata {
    pub attachment: WarmPublicationAttachment,
    pub diagnostics: WarmPublicationDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WarmPublicationAttachment {
    pub kind: String,
    pub attachment_version: u8,
    pub stream_key: String,
    pub subscription_id: String,
    pub authority_epoch: String,
    pub contract_key: String,
    pub projection_instance_key: String,
    pub lane: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WarmPublicationDiagnostics {
    pub upstream_coalesced_publication_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedWarmPublicationPayload {
    pub metadata: WarmPublicationMetadata,
    pub warm_frame_bytes: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MetricsSnapshot {
    pub max_in_flight_count: u32,
    pub max_pending_count: u32,
    pub pending_count: u32,
    pub upstream_coalesced_publication_count: u64,
    pub latest_delivered_publication_sequence: Option<String>,
}

pub fn decode_json<T: DeserializeOwned>(payload: &[u8], label: &str) -> Result<T, String> {
    serde_json::from_slice(payload).map_err(|error| format!("invalid {label} JSON: {error}"))
}

pub fn encode_json<T: Serialize>(value: &T, label: &str) -> Result<Vec<u8>, String> {
    serde_json::to_vec(value).map_err(|error| format!("failed to encode {label} JSON: {error}"))
}

pub fn extract_request_key(payload: &[u8], label: &str) -> Result<String, String> {
    let value: Value = decode_json(payload, label)?;
    let request_key = value
        .as_object()
        .and_then(|object| object.get("requestKey"))
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{label}.requestKey must be a non-empty string"))?;
    require_nonempty(request_key, &format!("{label}.requestKey"))?;
    Ok(request_key.to_string())
}

pub fn authority_event(kind: &str, authority_epoch: u64) -> Value {
    json!({
        "kind": kind,
        "authorityEpoch": authority_epoch.to_string(),
    })
}

pub fn subscribe_result(request_key: &str, result: Value) -> Value {
    json!({ "requestKey": request_key, "result": result })
}

pub fn unsubscribe_result(request_key: &str, result: Value) -> Value {
    json!({ "requestKey": request_key, "result": result })
}

pub fn control_success(request_key: &str, payload: Value) -> Value {
    json!({
        "kind": "control.response",
        "envelopeVersion": CONTROL_ENVELOPE_VERSION,
        "requestKey": request_key,
        "ok": true,
        "payload": payload,
    })
}

pub fn control_failure(
    request_key: &str,
    code: &str,
    message: &str,
    details: Option<Value>,
) -> Value {
    let mut failure = serde_json::Map::new();
    failure.insert("code".to_string(), Value::String(code.to_string()));
    failure.insert("message".to_string(), Value::String(message.to_string()));
    if let Some(details) = details {
        failure.insert("details".to_string(), details);
    }
    json!({
        "kind": "control.response",
        "envelopeVersion": CONTROL_ENVELOPE_VERSION,
        "requestKey": request_key,
        "ok": false,
        "failure": Value::Object(failure),
    })
}

pub fn metrics_response(request_key: &str, metrics: MetricsSnapshot) -> Value {
    json!({ "requestKey": request_key, "metrics": metrics })
}

pub fn encode_warm_publication_payload(
    metadata: &WarmPublicationMetadata,
    warm_frame_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let metadata_bytes = encode_json(metadata, "warm publication metadata")?;
    let metadata_byte_length = u32::try_from(metadata_bytes.len())
        .map_err(|_| "warm publication metadata byte length must fit in u32".to_string())?;
    let capacity = 4_usize
        .checked_add(metadata_bytes.len())
        .and_then(|value| value.checked_add(warm_frame_bytes.len()))
        .ok_or_else(|| "warm publication payload byte length overflowed usize".to_string())?;
    let mut payload = Vec::with_capacity(capacity);
    payload.extend_from_slice(&metadata_byte_length.to_le_bytes());
    payload.extend_from_slice(&metadata_bytes);
    payload.extend_from_slice(warm_frame_bytes);
    Ok(payload)
}

pub fn decode_warm_publication_payload(
    payload: &[u8],
) -> Result<DecodedWarmPublicationPayload, String> {
    if payload.len() < 4 {
        return Err("warm publication payload is shorter than metadata length prefix".to_string());
    }
    let metadata_byte_length =
        u32::from_le_bytes(payload[..4].try_into().expect("prefix length checked")) as usize;
    let metadata_end = 4_usize
        .checked_add(metadata_byte_length)
        .ok_or_else(|| "warm publication metadata range overflowed usize".to_string())?;
    if metadata_end > payload.len() {
        return Err(format!(
            "warm publication metadata length {metadata_byte_length} exceeds payload remainder {}",
            payload.len() - 4
        ));
    }
    let metadata = decode_json(&payload[4..metadata_end], "warm publication metadata")?;
    let warm_frame_bytes = payload[metadata_end..].to_vec();
    if warm_frame_bytes.is_empty() {
        return Err("warm publication must contain canonical warm frame bytes".to_string());
    }
    Ok(DecodedWarmPublicationPayload {
        metadata,
        warm_frame_bytes,
    })
}

pub fn validate_shutdown_payload(payload: &[u8]) -> Result<(), String> {
    let value: Value = decode_json(payload, "shutdown payload")?;
    match value.as_object() {
        Some(object) if object.is_empty() => Ok(()),
        _ => Err("shutdown payload must be exactly an empty object".to_string()),
    }
}

fn require_nonempty(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{label} must be a non-empty string"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        decode_warm_publication_payload, encode_warm_publication_payload,
        validate_shutdown_payload, WarmPublicationAttachment, WarmPublicationDiagnostics,
        WarmPublicationMetadata,
    };

    #[test]
    fn warm_publication_metadata_length_prefix_preserves_raw_frame_bytes() {
        let metadata = WarmPublicationMetadata {
            attachment: WarmPublicationAttachment {
                kind: "publication.warmFrame".to_string(),
                attachment_version: 1,
                stream_key: "stream".to_string(),
                subscription_id: "subscription-1".to_string(),
                authority_epoch: "42".to_string(),
                contract_key: "contract".to_string(),
                projection_instance_key: "instance".to_string(),
                lane: "warm".to_string(),
            },
            diagnostics: WarmPublicationDiagnostics {
                upstream_coalesced_publication_count: 3,
            },
        };
        let frame = [1, 2, 3, 5, 8];
        let encoded = encode_warm_publication_payload(&metadata, &frame).unwrap();
        let decoded = decode_warm_publication_payload(&encoded).unwrap();

        assert_eq!(decoded.metadata, metadata);
        assert_eq!(decoded.warm_frame_bytes, frame);
    }

    #[test]
    fn shutdown_payload_is_exact_empty_object() {
        validate_shutdown_payload(b"{}").unwrap();
        assert!(validate_shutdown_payload(b"{\"extra\":true}").is_err());
        assert!(validate_shutdown_payload(b"null").is_err());
    }
}
