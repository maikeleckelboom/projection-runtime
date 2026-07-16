use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::Path;
use warm_codec::frame::{
    decode_warm_lane_frame, encode_warm_lane_frame, frame_payload_hex, WarmLaneFrame,
};
use warm_codec::hex;
use warm_codec::payload::{
    decode_warm_snapshot_payload, encode_warm_snapshot_payload, json_equivalent, WarmManifest,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedContract {
    lane_manifests: LaneManifests,
    manifest: ResolvedManifest,
    semantic_version: String,
    warm_codec_version: Option<String>,
}

#[derive(Debug, Deserialize)]
struct LaneManifests {
    warm: WarmManifest,
}

#[derive(Debug, Deserialize)]
struct ResolvedManifest {
    key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WarmPayloadFixture {
    contract_key: String,
    expected: WarmPayloadExpected,
    fixture_kind: String,
    frame: WarmFrameFixture,
    semantic_version: String,
    snapshot: Value,
    warm_codec_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WarmPayloadExpected {
    decoded_frame: WarmExpectedDecodedFrame,
    decoded_frame_snapshot: Value,
    decoded_snapshot: Value,
    frame_bytes_hex: String,
    payload_bytes_hex: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WarmFrameFixture {
    baseline_epoch: u32,
    continuity_generation: u32,
    lane_sequence: Option<u32>,
    projection_instance_key: String,
    publication_sequence: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WarmExpectedDecodedFrame {
    baseline_epoch: u32,
    continuity_generation: u32,
    lane_sequence: Option<u32>,
    payload_bytes_hex: String,
    projection_instance_key: String,
    publication_sequence: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RustWarmOutput {
    pub fixture_kind: &'static str,
    pub fixture_name: &'static str,
    pub contract_key: String,
    pub semantic_version: String,
    pub warm_codec_version: String,
    pub payload_bytes_hex: String,
    pub frame_bytes_hex: String,
    pub decoded_frame: RustDecodedWarmFrame,
    pub decoded_snapshot: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RustDecodedWarmFrame {
    pub frame_byte_length: u32,
    pub contract_key: String,
    pub projection_instance_key: String,
    pub semantic_version: String,
    pub warm_codec_version: String,
    pub baseline_epoch: u32,
    pub continuity_generation: u32,
    pub publication_sequence: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lane_sequence: Option<u32>,
    pub payload_bytes_hex: String,
}

pub fn generate_warm_payload_v0_output(fixture_dir: &Path) -> Result<RustWarmOutput, String> {
    let resolved: ResolvedContract = read_json(&fixture_dir.join("resolved-contract.json"))?;
    let fixture: WarmPayloadFixture = read_json(&fixture_dir.join("warm-payload-fixture.json"))?;

    if fixture.fixture_kind != "warm-payload-fixture" {
        return Err(format!(
            "warm-payload-fixture fixtureKind must be warm-payload-fixture, got {}",
            fixture.fixture_kind
        ));
    }
    if fixture.contract_key != resolved.manifest.key {
        return Err(format!(
            "fixture contractKey {} does not match resolved manifest key {}",
            fixture.contract_key, resolved.manifest.key
        ));
    }
    if fixture.semantic_version != resolved.semantic_version {
        return Err("fixture semanticVersion does not match resolved contract".to_string());
    }
    let resolved_warm_codec_version = resolved
        .warm_codec_version
        .as_deref()
        .or(resolved.lane_manifests.warm.warm_codec_version.as_deref())
        .ok_or_else(|| "resolved contract is missing warmCodecVersion".to_string())?;
    if fixture.warm_codec_version != resolved_warm_codec_version {
        return Err("fixture warmCodecVersion does not match resolved contract".to_string());
    }
    if resolved
        .lane_manifests
        .warm
        .contract_key
        .as_deref()
        .is_some_and(|contract_key| contract_key != fixture.contract_key)
    {
        return Err(
            "warm lane manifest contractKey does not match fixture contractKey".to_string(),
        );
    }
    if resolved
        .lane_manifests
        .warm
        .semantic_version
        .as_deref()
        .is_some_and(|semantic_version| semantic_version != fixture.semantic_version)
    {
        return Err("warm lane manifest semanticVersion does not match fixture".to_string());
    }

    let actual_payload =
        encode_warm_snapshot_payload(&resolved.lane_manifests.warm, &fixture.snapshot)?;
    let expected_payload = hex::decode_lower(
        &fixture.expected.payload_bytes_hex,
        "expected.payloadBytesHex",
    )?;
    if actual_payload != expected_payload {
        return Err(format!(
            "Rust warm payload bytes {} do not match committed TypeScript fixture {}",
            hex::encode_lower(&actual_payload),
            fixture.expected.payload_bytes_hex
        ));
    }

    let decoded_snapshot =
        decode_warm_snapshot_payload(&resolved.lane_manifests.warm, &expected_payload)?;
    if !json_equivalent(&decoded_snapshot, &fixture.expected.decoded_snapshot) {
        return Err(format!(
            "Rust decoded committed payload snapshot {} does not match fixture decodedSnapshot {}",
            decoded_snapshot, fixture.expected.decoded_snapshot
        ));
    }

    let frame = WarmLaneFrame {
        contract_key: resolved.manifest.key.clone(),
        projection_instance_key: fixture.frame.projection_instance_key.clone(),
        semantic_version: hex::parse_u64_hex(&fixture.semantic_version, "semanticVersion")?,
        warm_codec_version: hex::parse_u64_hex(&fixture.warm_codec_version, "warmCodecVersion")?,
        baseline_epoch: fixture.frame.baseline_epoch,
        continuity_generation: fixture.frame.continuity_generation,
        publication_sequence: hex::parse_u64_hex(
            &fixture.frame.publication_sequence,
            "frame.publicationSequence",
        )?,
        lane_sequence: fixture.frame.lane_sequence,
        payload: actual_payload.clone(),
    };
    let actual_frame = encode_warm_lane_frame(&frame)?;
    let expected_frame =
        hex::decode_lower(&fixture.expected.frame_bytes_hex, "expected.frameBytesHex")?;
    if actual_frame != expected_frame {
        return Err(format!(
            "Rust warm frame bytes {} do not match committed TypeScript fixture {}",
            hex::encode_lower(&actual_frame),
            fixture.expected.frame_bytes_hex
        ));
    }

    let decoded_frame = decode_warm_lane_frame(&expected_frame)?;
    assert_decoded_frame_matches_fixture(&decoded_frame.frame, &fixture)?;
    let decoded_frame_snapshot =
        decode_warm_snapshot_payload(&resolved.lane_manifests.warm, &decoded_frame.frame.payload)?;
    if !json_equivalent(
        &decoded_frame_snapshot,
        &fixture.expected.decoded_frame_snapshot,
    ) {
        return Err(format!(
            "Rust decoded committed frame payload snapshot {} does not match fixture decodedFrameSnapshot {}",
            decoded_frame_snapshot, fixture.expected.decoded_frame_snapshot
        ));
    }

    let decoded_frame_payload_hex = frame_payload_hex(&decoded_frame.frame);

    Ok(RustWarmOutput {
        fixture_kind: "rust-warm-output",
        fixture_name: "warm-payload-v0",
        contract_key: resolved.manifest.key,
        semantic_version: fixture.semantic_version,
        warm_codec_version: fixture.warm_codec_version,
        payload_bytes_hex: hex::encode_lower(&actual_payload),
        frame_bytes_hex: hex::encode_lower(&actual_frame),
        decoded_frame: RustDecodedWarmFrame {
            frame_byte_length: decoded_frame.frame_byte_length,
            contract_key: decoded_frame.frame.contract_key,
            projection_instance_key: decoded_frame.frame.projection_instance_key,
            semantic_version: hex::format_u64_hex(decoded_frame.frame.semantic_version),
            warm_codec_version: hex::format_u64_hex(decoded_frame.frame.warm_codec_version),
            baseline_epoch: decoded_frame.frame.baseline_epoch,
            continuity_generation: decoded_frame.frame.continuity_generation,
            publication_sequence: hex::format_u64_hex(decoded_frame.frame.publication_sequence),
            lane_sequence: decoded_frame.frame.lane_sequence,
            payload_bytes_hex: decoded_frame_payload_hex,
        },
        decoded_snapshot,
    })
}

fn assert_decoded_frame_matches_fixture(
    frame: &WarmLaneFrame,
    fixture: &WarmPayloadFixture,
) -> Result<(), String> {
    let expected = &fixture.expected.decoded_frame;
    if frame.contract_key != fixture.contract_key {
        return Err("decoded committed frame contractKey does not match fixture".to_string());
    }
    if frame.projection_instance_key != expected.projection_instance_key {
        return Err(
            "decoded committed frame projectionInstanceKey does not match fixture".to_string(),
        );
    }
    if hex::format_u64_hex(frame.semantic_version) != fixture.semantic_version {
        return Err("decoded committed frame semanticVersion does not match fixture".to_string());
    }
    if hex::format_u64_hex(frame.warm_codec_version) != fixture.warm_codec_version {
        return Err("decoded committed frame warmCodecVersion does not match fixture".to_string());
    }
    if frame.baseline_epoch != expected.baseline_epoch {
        return Err("decoded committed frame baselineEpoch does not match fixture".to_string());
    }
    if frame.continuity_generation != expected.continuity_generation {
        return Err(
            "decoded committed frame continuityGeneration does not match fixture".to_string(),
        );
    }
    if hex::format_u64_hex(frame.publication_sequence) != expected.publication_sequence {
        return Err(
            "decoded committed frame publicationSequence does not match fixture".to_string(),
        );
    }
    if frame.lane_sequence != expected.lane_sequence {
        return Err("decoded committed frame laneSequence does not match fixture".to_string());
    }
    if hex::encode_lower(&frame.payload) != expected.payload_bytes_hex {
        return Err("decoded committed frame payload bytes do not match fixture".to_string());
    }
    Ok(())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let source = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&source)
        .map_err(|error| format!("failed to parse {} as JSON: {error}", path.display()))
}
