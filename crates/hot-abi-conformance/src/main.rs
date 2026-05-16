use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const FIXTURE_NAME: &str = "deck-runtime-v0";
const CONTRACT_KEY: &str = "fixture.deckRuntime";
const SYMBOL_STEM: &str = "DeckRuntime";
const HOT_ABI_VERSION: u64 = 1;
const TOTAL_REGION_BYTE_LENGTH: usize = 160;
const BLOCK_A_SIZE: usize = 72;
const BLOCK_B_START_OFFSET: usize = 72;
const SEQLOCK_OFFSET: usize = 72;
const BASELINE_EPOCH_OFFSET: usize = 80;
const CONTINUITY_GEN_OFFSET: usize = 84;
const PUBLICATION_SEQ_OFFSET: usize = 88;
const FIELD_DATA_ORIGIN: usize = 96;

const BEAT_PHASE01_OFFSET: usize = 96;
const LEVEL_OFFSET: usize = 100;
const LOOP_ACTIVE_OFFSET: usize = 104;
const MEDIA_TIME_SECONDS_OFFSET: usize = 112;
const SAMPLE_POSITION_OFFSET: usize = 120;
const STEM_GAINS_COUNT_OFFSET: usize = 128;
const STEM_GAINS_ELEMENTS_OFFSET: usize = 132;
const STEM_GAINS_MAX_COUNT: u64 = 4;
const STEM_GAINS_UNIT_BYTE_LENGTH: u64 = 4;
const TEMPO_RATIO_OFFSET: usize = 148;
const TRANSPORT_STATE_OFFSET: usize = 152;

const REGION_MAGIC: [u8; 4] = [0x53, 0x51, 0x4c, 0x4b];
const REGION_MAGIC_HEX: &str = "53514c4b";
const BLOCK_A_RESERVED_ZERO: [u8; 8] = [0; 8];
const BLOCK_A_RESERVED_ZERO_HEX: &str = "0000000000000000";

const SEQLOCK_COUNTER: u64 = 0x0000_0000_0000_0002;
const BASELINE_EPOCH: u32 = 7;
const CONTINUITY_GENERATION: u32 = 3;
const PUBLICATION_SEQUENCE: u64 = 0x0000_0000_0000_0001;
const SAMPLE_POSITION: u64 = 0x0020_0000_0000_0000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactManifest {
    artifact_manifest_version: u64,
    fixture_name: String,
    contract_key: String,
    symbol_stem: String,
    hot_abi_version: u64,
    hot_layout_version: String,
    source: ArtifactManifestSource,
    artifacts: ArtifactManifestArtifacts,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ArtifactManifestSource {
    hot_layout_manifest: String,
    hot_block_a_fixture: String,
    hot_complete_fixture_region: String,
    resolved_contract: String,
}

#[derive(Debug, Deserialize)]
struct ArtifactManifestArtifacts {
    reader: String,
    writer: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HotBlockAFixture {
    fixture_kind: String,
    contract_key: String,
    instance_key: String,
    semantic_version: String,
    hot_layout_version: String,
    field_count: u32,
    mutable_region_byte_length: u32,
    expected: HotBlockAExpected,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HotBlockAExpected {
    block_a_bytes_hex: String,
    decoded: HotBlockADecoded,
}

#[derive(Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct HotBlockADecoded {
    contract_key_hash_hex: String,
    field_count: u32,
    hot_abi_version: u32,
    hot_layout_version: String,
    instance_key_hash_hex: String,
    mutable_region_byte_length: u32,
    region_magic_hex: String,
    reserved_hex: String,
    semantic_version: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolvedContract {
    hot_layout_version: String,
    semantic_version: String,
    manifest: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HotCompleteFixtureRegion {
    fixture_kind: String,
    contract_key: String,
    instance_key: String,
    hot_layout_version: String,
    total_region_byte_length: u64,
    block_a_bytes_hex: String,
    complete_fixture_region_bytes_hex: String,
    decoded: HotCompleteFixtureRegionDecoded,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HotCompleteFixtureRegionDecoded {
    block_a: HotBlockADecoded,
}

#[derive(Debug)]
struct ConformanceInputs {
    artifact_manifest: ArtifactManifest,
    block_a: BlockAExpectation,
    total_region_byte_length: usize,
}

#[derive(Debug)]
struct BlockAExpectation {
    region_magic: [u8; 4],
    hot_abi_version: u32,
    contract_key_hash: [u8; 16],
    instance_key_hash: [u8; 16],
    semantic_version: u64,
    hot_layout_version: u64,
    field_count: u32,
    mutable_region_byte_length: u32,
    reserved: [u8; 8],
    block_a_bytes: [u8; BLOCK_A_SIZE],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RustHotWriterOutput {
    fixture_kind: &'static str,
    fixture_name: String,
    contract_key: String,
    hot_abi_version: u64,
    hot_layout_version: String,
    hot_region_bytes_hex: String,
    snapshot: SnapshotOutput,
    block_b: BlockBOutput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HotRegionBytesInput {
    hot_region_bytes_hex: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RustHotReaderOutput {
    fixture_kind: &'static str,
    fixture_name: String,
    contract_key: String,
    hot_abi_version: u64,
    hot_layout_version: String,
    hot_region_bytes_hex: String,
    snapshot: SnapshotOutput,
    block_b: BlockBOutput,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotOutput {
    beat_phase01: f32,
    level: f32,
    loop_active: bool,
    media_time_seconds: f64,
    sample_position: String,
    stem_gains: Vec<f32>,
    tempo_ratio: f32,
    transport_state: &'static str,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BlockBOutput {
    seqlock_counter: String,
    baseline_epoch: u32,
    continuity_generation: u32,
    publication_sequence: String,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("write-deck-runtime") => run_writer(&args[1..]),
        Some("read-deck-runtime") => run_reader(&args[1..]),
        _ => Err(usage().to_string()),
    }
}

fn run_writer(args: &[String]) -> Result<(), String> {
    let artifact_manifest_path = args.first().ok_or_else(|| usage().to_string())?;
    let artifact_manifest_path = PathBuf::from(artifact_manifest_path);
    let inputs = load_conformance_inputs(&artifact_manifest_path)?;
    let artifact_manifest = &inputs.artifact_manifest;

    let mut region = vec![0_u8; inputs.total_region_byte_length];
    write_block_a(&mut region, &inputs.block_a)?;
    write_block_b(&mut region);
    write_field_data(&mut region);

    let output = RustHotWriterOutput {
        fixture_kind: "rust-hot-writer-output",
        fixture_name: artifact_manifest.fixture_name.clone(),
        contract_key: artifact_manifest.contract_key.clone(),
        hot_abi_version: artifact_manifest.hot_abi_version,
        hot_layout_version: artifact_manifest.hot_layout_version.clone(),
        hot_region_bytes_hex: bytes_to_hex(&region),
        snapshot: SnapshotOutput {
            beat_phase01: 0.5,
            level: 0.25,
            loop_active: false,
            media_time_seconds: 128.5,
            sample_position: format_u64_hex_prefixed(SAMPLE_POSITION),
            stem_gains: vec![0.25, 0.5],
            tempo_ratio: 1.25,
            transport_state: "paused",
        },
        block_b: BlockBOutput {
            seqlock_counter: format_u64_hex_prefixed(SEQLOCK_COUNTER),
            baseline_epoch: BASELINE_EPOCH,
            continuity_generation: CONTINUITY_GENERATION,
            publication_sequence: format_u64_hex_prefixed(PUBLICATION_SEQUENCE),
        },
    };

    let json = serde_json::to_string_pretty(&output)
        .map_err(|error| format!("failed to serialize Rust hot writer output: {error}"))?;
    println!("{json}");

    Ok(())
}

fn run_reader(args: &[String]) -> Result<(), String> {
    let artifact_manifest_path = args.first().ok_or_else(|| usage().to_string())?;
    let hot_region_bytes_source = args.get(1).ok_or_else(|| usage().to_string())?;
    let artifact_manifest_path = PathBuf::from(artifact_manifest_path);
    let inputs = load_conformance_inputs(&artifact_manifest_path)?;
    let artifact_manifest = &inputs.artifact_manifest;

    let hot_region_bytes_hex = read_hot_region_bytes_hex(hot_region_bytes_source)?;
    let hot_region_bytes = hex_to_bytes(&hot_region_bytes_hex)?;
    if hot_region_bytes.len() != inputs.total_region_byte_length {
        return Err(format!(
            "hotRegionBytesHex length mismatch: expected {} bytes, got {} bytes",
            inputs.total_region_byte_length,
            hot_region_bytes.len()
        ));
    }
    validate_block_a(&hot_region_bytes, &inputs.block_a)?;
    reject_writer_active_seqlock(&hot_region_bytes)?;

    let output = RustHotReaderOutput {
        fixture_kind: "rust-hot-reader-output",
        fixture_name: artifact_manifest.fixture_name.clone(),
        contract_key: artifact_manifest.contract_key.clone(),
        hot_abi_version: artifact_manifest.hot_abi_version,
        hot_layout_version: artifact_manifest.hot_layout_version.clone(),
        hot_region_bytes_hex: bytes_to_hex(&hot_region_bytes),
        snapshot: read_snapshot(&hot_region_bytes)?,
        block_b: read_block_b(&hot_region_bytes),
    };

    let json = serde_json::to_string_pretty(&output)
        .map_err(|error| format!("failed to serialize Rust hot reader output: {error}"))?;
    println!("{json}");

    Ok(())
}

fn usage() -> &'static str {
    "usage: hot-abi-conformance write-deck-runtime <generated/artifacts.json>\n       hot-abi-conformance read-deck-runtime <generated/artifacts.json> <hotRegionBytesHex|hot-region-bytes.json>"
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    serde_json::from_str(&text)
        .map_err(|error| format!("failed to parse {} as JSON: {error}", path.display()))
}

fn read_json_value(path: &Path) -> Result<Value, String> {
    read_json(path)
}

fn load_conformance_inputs(artifact_manifest_path: &Path) -> Result<ConformanceInputs, String> {
    let artifact_manifest = read_json::<ArtifactManifest>(artifact_manifest_path)?;
    assert_artifact_manifest(&artifact_manifest)?;

    let hot_layout_manifest_path = resolve_manifest_relative_path(
        artifact_manifest_path,
        &artifact_manifest.source.hot_layout_manifest,
    )?;
    let hot_block_a_fixture_path = resolve_manifest_relative_path(
        artifact_manifest_path,
        &artifact_manifest.source.hot_block_a_fixture,
    )?;
    let hot_complete_fixture_region_path = resolve_manifest_relative_path(
        artifact_manifest_path,
        &artifact_manifest.source.hot_complete_fixture_region,
    )?;
    let resolved_contract_path = resolve_manifest_relative_path(
        artifact_manifest_path,
        &artifact_manifest.source.resolved_contract,
    )?;

    let hot_layout_manifest = read_json_value(&hot_layout_manifest_path)?;
    let hot_block_a_fixture = read_json::<HotBlockAFixture>(&hot_block_a_fixture_path)?;
    let hot_complete_fixture_region =
        read_json::<HotCompleteFixtureRegion>(&hot_complete_fixture_region_path)?;
    let resolved_contract = read_json::<ResolvedContract>(&resolved_contract_path)?;

    assert_manifest_agreement(&artifact_manifest, &hot_layout_manifest)?;
    assert_hot_layout_manifest(&hot_layout_manifest)?;

    let total_region_byte_length = total_region_byte_length(&hot_layout_manifest)?;
    let block_a = derive_block_a_expectation(
        &artifact_manifest,
        &hot_layout_manifest,
        &hot_block_a_fixture,
        &hot_complete_fixture_region,
        &resolved_contract,
        total_region_byte_length,
    )?;

    Ok(ConformanceInputs {
        artifact_manifest,
        block_a,
        total_region_byte_length,
    })
}

fn resolve_manifest_relative_path(
    artifact_manifest_path: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let source_path = Path::new(relative_path);
    if relative_path.is_empty() {
        return Err("artifact manifest source paths must be non-empty".to_string());
    }
    if source_path.is_absolute() {
        return Err(format!(
            "artifact manifest source path {relative_path:?} must be relative to artifacts.json"
        ));
    }

    let manifest_dir = artifact_manifest_path
        .parent()
        .ok_or_else(|| "artifact manifest path must have a parent directory".to_string())?;

    Ok(manifest_dir.join(source_path))
}

fn assert_artifact_manifest(manifest: &ArtifactManifest) -> Result<(), String> {
    assert_eq_u64(
        "artifactManifestVersion",
        manifest.artifact_manifest_version,
        1,
    )?;
    assert_eq_str("fixtureName", &manifest.fixture_name, FIXTURE_NAME)?;
    assert_eq_str("contractKey", &manifest.contract_key, CONTRACT_KEY)?;
    assert_eq_str("symbolStem", &manifest.symbol_stem, SYMBOL_STEM)?;
    assert_eq_u64("hotAbiVersion", manifest.hot_abi_version, HOT_ABI_VERSION)?;
    assert_manifest_source_path(
        "source.hotLayoutManifest",
        &manifest.source.hot_layout_manifest,
    )?;
    assert_manifest_source_path(
        "source.hotBlockAFixture",
        &manifest.source.hot_block_a_fixture,
    )?;
    assert_manifest_source_path(
        "source.hotCompleteFixtureRegion",
        &manifest.source.hot_complete_fixture_region,
    )?;
    assert_manifest_source_path(
        "source.resolvedContract",
        &manifest.source.resolved_contract,
    )?;
    assert_eq_str(
        "artifacts.reader",
        &manifest.artifacts.reader,
        "hot-reader.ts",
    )?;
    assert_eq_str(
        "artifacts.writer",
        &manifest.artifacts.writer,
        "hot-writer.ts",
    )?;

    Ok(())
}

fn assert_manifest_source_path(label: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("{label} must be non-empty"));
    }
    if Path::new(value).is_absolute() {
        return Err(format!("{label} must be relative to artifacts.json"));
    }

    Ok(())
}

fn assert_manifest_agreement(
    artifact_manifest: &ArtifactManifest,
    hot_layout_manifest: &Value,
) -> Result<(), String> {
    assert_json_str(
        hot_layout_manifest,
        "contractKey",
        &artifact_manifest.contract_key,
    )?;
    assert_json_u64(
        hot_layout_manifest,
        "hotAbiVersion",
        artifact_manifest.hot_abi_version,
    )?;
    assert_json_str(
        hot_layout_manifest,
        "hotLayoutVersion",
        &artifact_manifest.hot_layout_version,
    )?;

    Ok(())
}

fn derive_block_a_expectation(
    artifact_manifest: &ArtifactManifest,
    hot_layout_manifest: &Value,
    hot_block_a_fixture: &HotBlockAFixture,
    hot_complete_fixture_region: &HotCompleteFixtureRegion,
    resolved_contract: &ResolvedContract,
    total_region_byte_length: usize,
) -> Result<BlockAExpectation, String> {
    assert_eq_str(
        "hot-block-a-fixture.fixtureKind",
        &hot_block_a_fixture.fixture_kind,
        "hot-block-a-fixture",
    )?;
    assert_eq_str(
        "hot-complete-fixture-region.fixtureKind",
        &hot_complete_fixture_region.fixture_kind,
        "hot-complete-fixture-region",
    )?;
    assert_eq_str(
        "hot-block-a-fixture.contractKey",
        &hot_block_a_fixture.contract_key,
        &artifact_manifest.contract_key,
    )?;
    assert_eq_str(
        "hot-complete-fixture-region.contractKey",
        &hot_complete_fixture_region.contract_key,
        &artifact_manifest.contract_key,
    )?;
    assert_eq_str(
        "hot-complete-fixture-region.instanceKey",
        &hot_complete_fixture_region.instance_key,
        &hot_block_a_fixture.instance_key,
    )?;
    assert_eq_str(
        "hot-block-a-fixture.hotLayoutVersion",
        &hot_block_a_fixture.hot_layout_version,
        &artifact_manifest.hot_layout_version,
    )?;
    assert_eq_str(
        "hot-complete-fixture-region.hotLayoutVersion",
        &hot_complete_fixture_region.hot_layout_version,
        &artifact_manifest.hot_layout_version,
    )?;
    assert_eq_str(
        "resolved-contract.hotLayoutVersion",
        &resolved_contract.hot_layout_version,
        &artifact_manifest.hot_layout_version,
    )?;
    assert_eq_str(
        "hot-block-a-fixture.semanticVersion",
        &hot_block_a_fixture.semantic_version,
        &resolved_contract.semantic_version,
    )?;
    assert_json_str(
        &resolved_contract.manifest,
        "key",
        &artifact_manifest.contract_key,
    )?;

    let layout_field_count = hot_layout_field_count(hot_layout_manifest)?;
    assert_eq_u64(
        "hot-block-a-fixture.fieldCount",
        hot_block_a_fixture.field_count as u64,
        layout_field_count as u64,
    )?;
    assert_eq_u64(
        "hot-block-a-fixture.expected.decoded.fieldCount",
        hot_block_a_fixture.expected.decoded.field_count as u64,
        hot_block_a_fixture.field_count as u64,
    )?;
    assert_eq_u64(
        "hot-block-a-fixture.mutableRegionByteLength",
        hot_block_a_fixture.mutable_region_byte_length as u64,
        json_u64_field(hot_layout_manifest, "mutableRegionByteLength")?,
    )?;
    assert_eq_u64(
        "hot-block-a-fixture.expected.decoded.mutableRegionByteLength",
        hot_block_a_fixture
            .expected
            .decoded
            .mutable_region_byte_length as u64,
        hot_block_a_fixture.mutable_region_byte_length as u64,
    )?;
    assert_eq_u64(
        "hot-block-a-fixture.expected.decoded.hotAbiVersion",
        hot_block_a_fixture.expected.decoded.hot_abi_version as u64,
        HOT_ABI_VERSION,
    )?;
    assert_eq_str(
        "hot-block-a-fixture.expected.decoded.hotLayoutVersion",
        &hot_block_a_fixture.expected.decoded.hot_layout_version,
        &artifact_manifest.hot_layout_version,
    )?;
    assert_eq_str(
        "hot-block-a-fixture.expected.decoded.semanticVersion",
        &hot_block_a_fixture.expected.decoded.semantic_version,
        &resolved_contract.semantic_version,
    )?;

    if hot_complete_fixture_region.total_region_byte_length != total_region_byte_length as u64 {
        return Err(format!(
            "hot-complete-fixture-region totalRegionByteLength mismatch: expected {}, got {}",
            total_region_byte_length, hot_complete_fixture_region.total_region_byte_length
        ));
    }
    assert_eq_str(
        "hot-complete-fixture-region.blockABytesHex",
        &hot_complete_fixture_region.block_a_bytes_hex,
        &hot_block_a_fixture.expected.block_a_bytes_hex,
    )?;
    if hot_complete_fixture_region.decoded.block_a != hot_block_a_fixture.expected.decoded {
        return Err(
            "hot-complete-fixture-region decoded Block A must match hot-block-a-fixture expected decoded values"
                .to_string(),
        );
    }

    let region_magic = REGION_MAGIC;
    assert_eq_str(
        "hot-block-a-fixture.expected.decoded.regionMagicHex",
        &hot_block_a_fixture.expected.decoded.region_magic_hex,
        REGION_MAGIC_HEX,
    )?;
    let contract_key_hash = parse_hex_bytes_exact::<16>(
        &hot_block_a_fixture.expected.decoded.contract_key_hash_hex,
        "hot-block-a-fixture.expected.decoded.contractKeyHashHex",
    )?;
    let instance_key_hash = parse_hex_bytes_exact::<16>(
        &hot_block_a_fixture.expected.decoded.instance_key_hash_hex,
        "hot-block-a-fixture.expected.decoded.instanceKeyHashHex",
    )?;
    let reserved = BLOCK_A_RESERVED_ZERO;
    assert_eq_str(
        "hot-block-a-fixture.expected.decoded.reservedHex",
        &hot_block_a_fixture.expected.decoded.reserved_hex,
        BLOCK_A_RESERVED_ZERO_HEX,
    )?;
    let semantic_version = parse_u64_hex(
        &resolved_contract.semantic_version,
        "resolved-contract.semanticVersion",
    )?;
    let hot_layout_version = parse_u64_hex(
        &hot_block_a_fixture.hot_layout_version,
        "hot-block-a-fixture.hotLayoutVersion",
    )?;
    let block_a_bytes = parse_hex_bytes_exact::<BLOCK_A_SIZE>(
        &hot_block_a_fixture.expected.block_a_bytes_hex,
        "hot-block-a-fixture.expected.blockABytesHex",
    )?;
    let complete_region_bytes = hex_to_bytes_with_label(
        &hot_complete_fixture_region.complete_fixture_region_bytes_hex,
        "hot-complete-fixture-region.completeFixtureRegionBytesHex",
    )?;

    if complete_region_bytes.len() != total_region_byte_length {
        return Err(format!(
            "hot-complete-fixture-region completeFixtureRegionBytesHex length mismatch: expected {} bytes, got {} bytes",
            total_region_byte_length,
            complete_region_bytes.len()
        ));
    }
    if complete_region_bytes[0..BLOCK_A_SIZE] != block_a_bytes[..] {
        return Err(
            "hot-complete-fixture-region Block A bytes must match hot-block-a-fixture expected bytes"
                .to_string(),
        );
    }

    let computed_contract_key_hash = identity_hash_16(&artifact_manifest.contract_key);
    if contract_key_hash != computed_contract_key_hash {
        return Err(format!(
            "hot-block-a-fixture.expected.decoded.contractKeyHashHex mismatch: expected hash of contractKey {}, got {}",
            bytes_to_hex(&computed_contract_key_hash),
            bytes_to_hex(&contract_key_hash)
        ));
    }
    let computed_instance_key_hash = identity_hash_16(&hot_block_a_fixture.instance_key);
    if instance_key_hash != computed_instance_key_hash {
        return Err(format!(
            "hot-block-a-fixture.expected.decoded.instanceKeyHashHex mismatch: expected hash of instanceKey {}, got {}",
            bytes_to_hex(&computed_instance_key_hash),
            bytes_to_hex(&instance_key_hash)
        ));
    }

    let block_a = BlockAExpectation {
        region_magic,
        hot_abi_version: HOT_ABI_VERSION as u32,
        contract_key_hash,
        instance_key_hash,
        semantic_version,
        hot_layout_version,
        field_count: hot_block_a_fixture.field_count,
        mutable_region_byte_length: hot_block_a_fixture.mutable_region_byte_length,
        reserved,
        block_a_bytes,
    };

    validate_block_a(&complete_region_bytes, &block_a)?;

    Ok(block_a)
}

fn assert_hot_layout_manifest(manifest: &Value) -> Result<(), String> {
    assert_json_str(manifest, "contractKey", CONTRACT_KEY)?;
    assert_json_u64(manifest, "hotAbiVersion", HOT_ABI_VERSION)?;
    assert_json_u64(manifest, "blockASize", BLOCK_A_SIZE as u64)?;
    assert_json_u64(
        manifest,
        "totalRegionByteLength",
        TOTAL_REGION_BYTE_LENGTH as u64,
    )?;
    assert_json_u64(manifest, "blockBStartOffset", BLOCK_B_START_OFFSET as u64)?;
    assert_json_u64(manifest, "seqlockOffset", SEQLOCK_OFFSET as u64)?;
    assert_json_u64(
        manifest,
        "baselineEpochOffset",
        BASELINE_EPOCH_OFFSET as u64,
    )?;
    assert_json_u64(
        manifest,
        "continuityGenOffset",
        CONTINUITY_GEN_OFFSET as u64,
    )?;
    assert_json_u64(
        manifest,
        "publicationSeqOffset",
        PUBLICATION_SEQ_OFFSET as u64,
    )?;
    assert_json_u64(manifest, "fieldDataOrigin", FIELD_DATA_ORIGIN as u64)?;

    assert_fixed_scalar_field(manifest, "beatPhase01", BEAT_PHASE01_OFFSET, 4, 4, "f32")?;
    assert_fixed_scalar_field(manifest, "level", LEVEL_OFFSET, 4, 4, "f32")?;
    assert_fixed_scalar_field(manifest, "loopActive", LOOP_ACTIVE_OFFSET, 1, 1, "bool")?;
    assert_fixed_scalar_field(
        manifest,
        "mediaTimeSeconds",
        MEDIA_TIME_SECONDS_OFFSET,
        8,
        8,
        "f64",
    )?;
    assert_fixed_scalar_field(
        manifest,
        "samplePosition",
        SAMPLE_POSITION_OFFSET,
        8,
        8,
        "u64",
    )?;
    assert_bounded_array_field(manifest)?;
    assert_fixed_scalar_field(manifest, "tempoRatio", TEMPO_RATIO_OFFSET, 4, 4, "f32")?;
    assert_fixed_enum_field(manifest)?;
    assert_stem_gains_reservation(manifest)?;

    Ok(())
}

fn assert_fixed_scalar_field(
    manifest: &Value,
    dot_path: &str,
    absolute_offset: usize,
    alignment: u64,
    byte_span: u64,
    scalar_type: &str,
) -> Result<(), String> {
    let field = field_by_dot_path(manifest, dot_path)?;
    assert_json_u64(field, "absoluteOffset", absolute_offset as u64)?;
    assert_json_u64(field, "alignment", alignment)?;
    assert_json_u64(field, "byteSpan", byte_span)?;
    let shape = object_field(field, "shape")?;
    assert_json_str(shape, "kind", "FixedScalar")?;
    assert_json_str(shape, "type", scalar_type)?;
    Ok(())
}

fn assert_bounded_array_field(manifest: &Value) -> Result<(), String> {
    let field = field_by_dot_path(manifest, "stemGains")?;
    assert_json_u64(field, "absoluteOffset", STEM_GAINS_COUNT_OFFSET as u64)?;
    assert_json_u64(field, "alignment", 4)?;
    assert_json_u64(field, "byteSpan", 20)?;
    let shape = object_field(field, "shape")?;
    assert_json_str(shape, "kind", "BoundedArray")?;
    assert_json_str(shape, "elementType", "f32")?;
    assert_json_u64(shape, "maxLength", STEM_GAINS_MAX_COUNT)?;
    Ok(())
}

fn assert_fixed_enum_field(manifest: &Value) -> Result<(), String> {
    let field = field_by_dot_path(manifest, "transportState")?;
    assert_json_u64(field, "absoluteOffset", TRANSPORT_STATE_OFFSET as u64)?;
    assert_json_u64(field, "alignment", 1)?;
    assert_json_u64(field, "byteSpan", 1)?;
    let shape = object_field(field, "shape")?;
    assert_json_str(shape, "kind", "FixedEnum")?;
    assert_json_str(shape, "storage", "u8")?;

    let variants = shape
        .get("variants")
        .and_then(Value::as_array)
        .ok_or_else(|| "transportState.shape.variants must be an array".to_string())?;
    let expected = ["stopped", "cueing", "playing", "paused"];
    if variants.len() != expected.len() {
        return Err(format!(
            "transportState variants length mismatch: expected {}, got {}",
            expected.len(),
            variants.len()
        ));
    }
    for (index, expected_variant) in expected.iter().enumerate() {
        let actual = variants[index]
            .as_str()
            .ok_or_else(|| format!("transportState variant {index} must be a string"))?;
        assert_eq_str(
            &format!("transportState.shape.variants[{index}]"),
            actual,
            expected_variant,
        )?;
    }

    Ok(())
}

fn assert_stem_gains_reservation(manifest: &Value) -> Result<(), String> {
    let reservations = manifest
        .get("reservations")
        .and_then(Value::as_array)
        .ok_or_else(|| "reservations must be an array".to_string())?;

    if reservations.len() != 1 {
        return Err(format!(
            "reservations length mismatch: expected 1, got {}",
            reservations.len()
        ));
    }

    let reservation = &reservations[0];
    assert_json_str(reservation, "dotPath", "stemGains")?;
    assert_json_u64(
        reservation,
        "countFieldOffset",
        STEM_GAINS_COUNT_OFFSET as u64,
    )?;
    assert_json_u64(
        reservation,
        "elementsOffset",
        STEM_GAINS_ELEMENTS_OFFSET as u64,
    )?;
    assert_json_u64(reservation, "maxCount", STEM_GAINS_MAX_COUNT)?;
    assert_json_u64(reservation, "unitByteLength", STEM_GAINS_UNIT_BYTE_LENGTH)?;

    Ok(())
}

fn field_by_dot_path<'a>(manifest: &'a Value, dot_path: &str) -> Result<&'a Value, String> {
    let fields = manifest
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| "fields must be an array".to_string())?;

    fields
        .iter()
        .find(|field| field.get("dotPath").and_then(Value::as_str) == Some(dot_path))
        .ok_or_else(|| format!("missing expected field {dot_path}"))
}

fn hot_layout_field_count(manifest: &Value) -> Result<usize, String> {
    Ok(manifest
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| "fields must be an array".to_string())?
        .len())
}

fn total_region_byte_length(manifest: &Value) -> Result<usize, String> {
    usize::try_from(json_u64_field(manifest, "totalRegionByteLength")?)
        .map_err(|_| "totalRegionByteLength does not fit usize".to_string())
}

fn object_field<'a>(value: &'a Value, key: &str) -> Result<&'a Value, String> {
    let nested = value
        .get(key)
        .ok_or_else(|| format!("missing JSON field {key}"))?;
    if !nested.is_object() {
        return Err(format!("{key} must be an object"));
    }
    Ok(nested)
}

fn assert_json_str(value: &Value, key: &str, expected: &str) -> Result<(), String> {
    let actual = value
        .get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("{key} must be a string"))?;
    assert_eq_str(key, actual, expected)
}

fn assert_json_u64(value: &Value, key: &str, expected: u64) -> Result<(), String> {
    let actual = json_u64_field(value, key)?;
    assert_eq_u64(key, actual, expected)
}

fn json_u64_field(value: &Value, key: &str) -> Result<u64, String> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("{key} must be an unsigned integer"))
}

fn assert_eq_str(label: &str, actual: &str, expected: &str) -> Result<(), String> {
    if actual != expected {
        return Err(format!(
            "{label} mismatch: expected {expected:?}, got {actual:?}"
        ));
    }

    Ok(())
}

fn assert_eq_u64(label: &str, actual: u64, expected: u64) -> Result<(), String> {
    if actual != expected {
        return Err(format!(
            "{label} mismatch: expected {expected}, got {actual}"
        ));
    }

    Ok(())
}

fn write_block_b(region: &mut [u8]) {
    write_u64_le(region, SEQLOCK_OFFSET, SEQLOCK_COUNTER);
    write_u32_le(region, BASELINE_EPOCH_OFFSET, BASELINE_EPOCH);
    write_u32_le(region, CONTINUITY_GEN_OFFSET, CONTINUITY_GENERATION);
    write_u64_le(region, PUBLICATION_SEQ_OFFSET, PUBLICATION_SEQUENCE);
}

fn write_block_a(region: &mut [u8], block_a: &BlockAExpectation) -> Result<(), String> {
    region[0..4].copy_from_slice(&block_a.region_magic);
    write_u32_le(region, 4, block_a.hot_abi_version);
    region[8..24].copy_from_slice(&block_a.contract_key_hash);
    region[24..40].copy_from_slice(&block_a.instance_key_hash);
    write_u64_le(region, 40, block_a.semantic_version);
    write_u64_le(region, 48, block_a.hot_layout_version);
    write_u32_le(region, 56, block_a.field_count);
    write_u32_le(region, 60, block_a.mutable_region_byte_length);
    region[64..72].copy_from_slice(&block_a.reserved);

    if region[0..BLOCK_A_SIZE] != block_a.block_a_bytes[..] {
        return Err("declared Block A bytes did not match decoded fixture values".to_string());
    }

    Ok(())
}

fn validate_block_a(region: &[u8], block_a: &BlockAExpectation) -> Result<(), String> {
    if region[0..4] != block_a.region_magic {
        return Err(format!(
            "Block A regionMagic mismatch: expected {}",
            bytes_to_hex(&block_a.region_magic)
        ));
    }

    let hot_abi_version = read_u32_le(region, 4);
    if hot_abi_version != block_a.hot_abi_version {
        return Err(format!(
            "Block A hotAbiVersion mismatch: expected {}, got {}",
            block_a.hot_abi_version, hot_abi_version
        ));
    }

    if region[8..24] != block_a.contract_key_hash {
        return Err(format!(
            "Block A contractKeyHash mismatch: expected {}",
            bytes_to_hex(&block_a.contract_key_hash)
        ));
    }

    if region[24..40] != block_a.instance_key_hash {
        return Err(format!(
            "Block A instanceKeyHash mismatch: expected {}",
            bytes_to_hex(&block_a.instance_key_hash)
        ));
    }

    let semantic_version = read_u64_le(region, 40);
    if semantic_version != block_a.semantic_version {
        return Err(format!(
            "Block A semanticVersion mismatch: expected 0x{:016x}, got 0x{:016x}",
            block_a.semantic_version, semantic_version
        ));
    }

    let hot_layout_version = read_u64_le(region, 48);
    if hot_layout_version != block_a.hot_layout_version {
        return Err(format!(
            "Block A hotLayoutVersion mismatch: expected 0x{:016x}, got 0x{:016x}",
            block_a.hot_layout_version, hot_layout_version
        ));
    }

    let field_count = read_u32_le(region, 56);
    if field_count != block_a.field_count {
        return Err(format!(
            "Block A fieldCount mismatch: expected {}, got {}",
            block_a.field_count, field_count
        ));
    }

    let mutable_region_byte_length = read_u32_le(region, 60);
    if mutable_region_byte_length != block_a.mutable_region_byte_length {
        return Err(format!(
            "Block A mutableRegionByteLength mismatch: expected {}, got {}",
            block_a.mutable_region_byte_length, mutable_region_byte_length
        ));
    }

    if region[64..72] != block_a.reserved[..] {
        return Err("Block A reserved bytes must be zero".to_string());
    }

    Ok(())
}

fn write_field_data(region: &mut [u8]) {
    write_f32_le(region, BEAT_PHASE01_OFFSET, 0.5);
    write_f32_le(region, LEVEL_OFFSET, 0.25);
    region[LOOP_ACTIVE_OFFSET] = 0;
    write_f64_le(region, MEDIA_TIME_SECONDS_OFFSET, 128.5);
    write_u64_le(region, SAMPLE_POSITION_OFFSET, SAMPLE_POSITION);
    write_u32_le(region, STEM_GAINS_COUNT_OFFSET, 2);
    write_f32_le(region, STEM_GAINS_ELEMENTS_OFFSET, 0.25);
    write_f32_le(
        region,
        STEM_GAINS_ELEMENTS_OFFSET + STEM_GAINS_UNIT_BYTE_LENGTH as usize,
        0.5,
    );
    region[STEM_GAINS_ELEMENTS_OFFSET + 8..STEM_GAINS_ELEMENTS_OFFSET + 16].fill(0);
    write_f32_le(region, TEMPO_RATIO_OFFSET, 1.25);
    region[TRANSPORT_STATE_OFFSET] = 3;
}

fn write_u32_le(region: &mut [u8], offset: usize, value: u32) {
    region[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn write_u64_le(region: &mut [u8], offset: usize, value: u64) {
    region[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn write_f32_le(region: &mut [u8], offset: usize, value: f32) {
    region[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
}

fn write_f64_le(region: &mut [u8], offset: usize, value: f64) {
    region[offset..offset + 8].copy_from_slice(&value.to_le_bytes());
}

fn read_hot_region_bytes_hex(source: &str) -> Result<String, String> {
    let path = Path::new(source);
    if path.exists() {
        let text = fs::read_to_string(path)
            .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
        let input = serde_json::from_str::<HotRegionBytesInput>(&text).map_err(|error| {
            format!(
                "failed to parse {} as hot region bytes JSON: {error}",
                path.display()
            )
        })?;
        return Ok(input.hot_region_bytes_hex);
    }

    Ok(source.to_string())
}

fn read_snapshot(region: &[u8]) -> Result<SnapshotOutput, String> {
    Ok(SnapshotOutput {
        beat_phase01: read_f32_le(region, BEAT_PHASE01_OFFSET),
        level: read_f32_le(region, LEVEL_OFFSET),
        loop_active: read_bool(region, LOOP_ACTIVE_OFFSET, "loopActive")?,
        media_time_seconds: read_f64_le(region, MEDIA_TIME_SECONDS_OFFSET),
        sample_position: format_u64_hex_prefixed(read_u64_le(region, SAMPLE_POSITION_OFFSET)),
        stem_gains: read_stem_gains(region)?,
        tempo_ratio: read_f32_le(region, TEMPO_RATIO_OFFSET),
        transport_state: read_transport_state(region)?,
    })
}

fn reject_writer_active_seqlock(region: &[u8]) -> Result<(), String> {
    let seqlock_counter = read_u64_le(region, SEQLOCK_OFFSET);
    if seqlock_counter & 1 == 1 {
        return Err(format!(
            "seqlockCounter indicates writer-active state: expected even counter, got {}",
            format_u64_hex_prefixed(seqlock_counter)
        ));
    }

    Ok(())
}

fn read_block_b(region: &[u8]) -> BlockBOutput {
    BlockBOutput {
        seqlock_counter: format_u64_hex_prefixed(read_u64_le(region, SEQLOCK_OFFSET)),
        baseline_epoch: read_u32_le(region, BASELINE_EPOCH_OFFSET),
        continuity_generation: read_u32_le(region, CONTINUITY_GEN_OFFSET),
        publication_sequence: format_u64_hex_prefixed(read_u64_le(region, PUBLICATION_SEQ_OFFSET)),
    }
}

fn read_stem_gains(region: &[u8]) -> Result<Vec<f32>, String> {
    let count = read_u32_le(region, STEM_GAINS_COUNT_OFFSET);
    if count > STEM_GAINS_MAX_COUNT as u32 {
        return Err(format!(
            "stemGains bounded array count exceeds maxCount: expected <= {}, got {}",
            STEM_GAINS_MAX_COUNT, count
        ));
    }

    let mut values = Vec::with_capacity(count as usize);
    for index in 0..count as usize {
        values.push(read_f32_le(
            region,
            STEM_GAINS_ELEMENTS_OFFSET + index * STEM_GAINS_UNIT_BYTE_LENGTH as usize,
        ));
    }

    Ok(values)
}

fn read_bool(region: &[u8], offset: usize, field_name: &str) -> Result<bool, String> {
    match region[offset] {
        0 => Ok(false),
        1 => Ok(true),
        value => Err(format!(
            "{field_name} bool byte must be 0 or 1, got {value}"
        )),
    }
}

fn read_transport_state(region: &[u8]) -> Result<&'static str, String> {
    match region[TRANSPORT_STATE_OFFSET] {
        0 => Ok("stopped"),
        1 => Ok("cueing"),
        2 => Ok("playing"),
        3 => Ok("paused"),
        value => Err(format!(
            "transportState enum discriminant is outside variants: {value}"
        )),
    }
}

fn read_u32_le(region: &[u8], offset: usize) -> u32 {
    let mut bytes = [0_u8; 4];
    bytes.copy_from_slice(&region[offset..offset + 4]);
    u32::from_le_bytes(bytes)
}

fn read_u64_le(region: &[u8], offset: usize) -> u64 {
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&region[offset..offset + 8]);
    u64::from_le_bytes(bytes)
}

fn read_f32_le(region: &[u8], offset: usize) -> f32 {
    let mut bytes = [0_u8; 4];
    bytes.copy_from_slice(&region[offset..offset + 4]);
    f32::from_le_bytes(bytes)
}

fn read_f64_le(region: &[u8], offset: usize) -> f64 {
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&region[offset..offset + 8]);
    f64::from_le_bytes(bytes)
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push_str(&format!("{byte:02x}"));
    }
    output
}

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    hex_to_bytes_with_label(hex, "hotRegionBytesHex")
}

fn hex_to_bytes_with_label(hex: &str, label: &str) -> Result<Vec<u8>, String> {
    if hex.len() % 2 != 0 {
        return Err(format!("{label} must have an even number of hex digits"));
    }

    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let chars: Vec<u8> = hex.bytes().collect();
    for index in (0..chars.len()).step_by(2) {
        let high = hex_nibble(chars[index])
            .ok_or_else(|| format!("{label} contains a non-hex digit at character {}", index))?;
        let low = hex_nibble(chars[index + 1]).ok_or_else(|| {
            format!(
                "{label} contains a non-hex digit at character {}",
                index + 1
            )
        })?;
        bytes.push((high << 4) | low);
    }

    Ok(bytes)
}

fn parse_hex_bytes_exact<const N: usize>(hex: &str, label: &str) -> Result<[u8; N], String> {
    let bytes = hex_to_bytes_with_label(hex, label)?;
    if bytes.len() != N {
        return Err(format!(
            "{label} length mismatch: expected {} bytes, got {} bytes",
            N,
            bytes.len()
        ));
    }

    bytes
        .try_into()
        .map_err(|_| format!("{label} length mismatch: expected {N} bytes"))
}

fn parse_u64_hex(hex: &str, label: &str) -> Result<u64, String> {
    if hex.len() != 16 {
        return Err(format!("{label} must be a 16-digit lowercase hex u64"));
    }

    u64::from_str_radix(hex, 16).map_err(|error| format!("failed to parse {label}: {error}"))
}

fn identity_hash_16(value: &str) -> [u8; 16] {
    let digest = Sha256::digest(value.as_bytes());
    let mut output = [0_u8; 16];
    output.copy_from_slice(&digest[0..16]);
    output
}

fn hex_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn format_u64_hex_prefixed(value: u64) -> String {
    format!("0x{value:016x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_block_a_expectation() -> BlockAExpectation {
        let mut block_a_bytes = [0_u8; BLOCK_A_SIZE];
        let semantic_version = 0xe363_6f7c_dffa_73b2;
        let hot_layout_version = 0xadef_6ee4_8efd_daed;
        let contract_key_hash = identity_hash_16(CONTRACT_KEY);
        let instance_key_hash = identity_hash_16("deck-runtime-v0.instance");

        block_a_bytes[0..4].copy_from_slice(&[0x53, 0x51, 0x4c, 0x4b]);
        write_u32_le(&mut block_a_bytes, 4, HOT_ABI_VERSION as u32);
        block_a_bytes[8..24].copy_from_slice(&contract_key_hash);
        block_a_bytes[24..40].copy_from_slice(&instance_key_hash);
        write_u64_le(&mut block_a_bytes, 40, semantic_version);
        write_u64_le(&mut block_a_bytes, 48, hot_layout_version);
        write_u32_le(&mut block_a_bytes, 56, 8);
        write_u32_le(&mut block_a_bytes, 60, 88);

        BlockAExpectation {
            region_magic: [0x53, 0x51, 0x4c, 0x4b],
            hot_abi_version: HOT_ABI_VERSION as u32,
            contract_key_hash,
            instance_key_hash,
            semantic_version,
            hot_layout_version,
            field_count: 8,
            mutable_region_byte_length: 88,
            reserved: [0; 8],
            block_a_bytes,
        }
    }

    #[test]
    fn writes_little_endian_block_b_values() {
        let mut region = vec![0_u8; TOTAL_REGION_BYTE_LENGTH];

        write_block_b(&mut region);

        assert_eq!(
            &region[SEQLOCK_OFFSET..SEQLOCK_OFFSET + 8],
            &[2, 0, 0, 0, 0, 0, 0, 0]
        );
        assert_eq!(
            &region[BASELINE_EPOCH_OFFSET..BASELINE_EPOCH_OFFSET + 4],
            &[7, 0, 0, 0]
        );
        assert_eq!(
            &region[CONTINUITY_GEN_OFFSET..CONTINUITY_GEN_OFFSET + 4],
            &[3, 0, 0, 0]
        );
        assert_eq!(
            &region[PUBLICATION_SEQ_OFFSET..PUBLICATION_SEQ_OFFSET + 8],
            &[1, 0, 0, 0, 0, 0, 0, 0]
        );
    }

    #[test]
    fn writes_block_a_header_values() {
        let block_a = test_block_a_expectation();
        let mut region = vec![0_u8; TOTAL_REGION_BYTE_LENGTH];

        write_block_a(&mut region, &block_a).unwrap();

        assert_eq!(&region[0..4], &block_a.region_magic);
        assert_eq!(read_u32_le(&region, 4), block_a.hot_abi_version);
        assert_eq!(&region[8..24], &identity_hash_16(CONTRACT_KEY));
        assert_eq!(
            &region[24..40],
            &identity_hash_16("deck-runtime-v0.instance")
        );
        assert_eq!(read_u64_le(&region, 40), 0xe363_6f7c_dffa_73b2);
        assert_eq!(read_u64_le(&region, 48), 0xadef_6ee4_8efd_daed);
        assert_eq!(read_u32_le(&region, 56), 8);
        assert_eq!(read_u32_le(&region, 60), 88);
        assert_eq!(&region[64..72], &[0; 8]);
        validate_block_a(&region, &block_a).unwrap();
    }

    #[test]
    fn zeroes_unused_bounded_array_slots() {
        let mut region = vec![0_u8; TOTAL_REGION_BYTE_LENGTH];
        region[STEM_GAINS_ELEMENTS_OFFSET + 8..STEM_GAINS_ELEMENTS_OFFSET + 16].fill(0xff);

        write_field_data(&mut region);

        assert_eq!(
            &region[STEM_GAINS_ELEMENTS_OFFSET + 8..STEM_GAINS_ELEMENTS_OFFSET + 16],
            &[0, 0, 0, 0, 0, 0, 0, 0]
        );
    }

    #[test]
    fn formats_u64_hex_with_prefix_and_sixteen_digits() {
        assert_eq!(
            format_u64_hex_prefixed(SAMPLE_POSITION),
            "0x0020000000000000"
        );
    }

    #[test]
    fn reads_only_bounded_array_logical_values() {
        let mut region = vec![0_u8; TOTAL_REGION_BYTE_LENGTH];
        write_u32_le(&mut region, STEM_GAINS_COUNT_OFFSET, 2);
        write_f32_le(&mut region, STEM_GAINS_ELEMENTS_OFFSET, 0.25);
        write_f32_le(
            &mut region,
            STEM_GAINS_ELEMENTS_OFFSET + STEM_GAINS_UNIT_BYTE_LENGTH as usize,
            0.5,
        );
        write_f32_le(
            &mut region,
            STEM_GAINS_ELEMENTS_OFFSET + 2 * STEM_GAINS_UNIT_BYTE_LENGTH as usize,
            0.75,
        );

        assert_eq!(read_stem_gains(&region).unwrap(), vec![0.25, 0.5]);
    }

    #[test]
    fn rejects_bounded_array_count_overflow() {
        let mut region = vec![0_u8; TOTAL_REGION_BYTE_LENGTH];
        write_u32_le(&mut region, STEM_GAINS_COUNT_OFFSET, 5);

        assert!(read_stem_gains(&region)
            .unwrap_err()
            .contains("stemGains bounded array count exceeds maxCount"));
    }

    #[test]
    fn rejects_writer_active_seqlock_counter() {
        let mut region = vec![0_u8; TOTAL_REGION_BYTE_LENGTH];
        write_u64_le(&mut region, SEQLOCK_OFFSET, 3);

        assert_eq!(
            reject_writer_active_seqlock(&region).unwrap_err(),
            "seqlockCounter indicates writer-active state: expected even counter, got 0x0000000000000003"
        );
    }
}
