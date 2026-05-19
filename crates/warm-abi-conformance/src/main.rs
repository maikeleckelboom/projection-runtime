mod fixture;
mod frame;
mod hex;
mod payload;

use std::env;
use std::path::{Path, PathBuf};
use std::process;

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next().ok_or_else(usage)?;

    match command.as_str() {
        "warm-payload-v0" => {
            let fixture_dir = args
                .next()
                .map(PathBuf::from)
                .unwrap_or_else(|| default_warm_payload_fixture_dir().to_path_buf());
            if args.next().is_some() {
                return Err(usage());
            }

            let output = fixture::generate_warm_payload_v0_output(&fixture_dir)?;
            println!(
                "{}",
                serde_json::to_string_pretty(&output)
                    .map_err(|error| format!("failed to serialize Rust warm output: {error}"))?
            );
            Ok(())
        }
        _ => Err(usage()),
    }
}

fn usage() -> String {
    "usage: warm-abi-conformance warm-payload-v0 [fixtures/projection-runtime/warm-payload-v0]"
        .to_string()
}

fn default_warm_payload_fixture_dir() -> &'static Path {
    Path::new(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/projection-runtime/warm-payload-v0"
    ))
}

#[cfg(test)]
mod tests {
    use super::default_warm_payload_fixture_dir;
    use crate::fixture;
    use crate::payload::json_equivalent;
    use serde_json::Value;
    use std::fs;

    #[test]
    fn warm_payload_v0_matches_committed_payload_and_frame_bytes() {
        let output =
            fixture::generate_warm_payload_v0_output(default_warm_payload_fixture_dir()).unwrap();
        let fixture: Value = serde_json::from_str(
            &fs::read_to_string(
                default_warm_payload_fixture_dir().join("warm-payload-fixture.json"),
            )
            .unwrap(),
        )
        .unwrap();
        let expected = fixture.get("expected").unwrap();
        let expected_payload_bytes_hex = expected.get("payloadBytesHex").unwrap().as_str().unwrap();
        let expected_frame_bytes_hex = expected.get("frameBytesHex").unwrap().as_str().unwrap();

        assert_eq!(output.fixture_kind, "rust-warm-output");
        assert_eq!(output.fixture_name, "warm-payload-v0");
        assert_eq!(output.contract_key, "fixture.warmPayload.v0");
        assert_eq!(output.payload_bytes_hex, expected_payload_bytes_hex);
        assert_eq!(output.frame_bytes_hex, expected_frame_bytes_hex);
        assert_eq!(
            u64::from(output.decoded_frame.frame_byte_length),
            expected_frame_bytes_hex.len() as u64 / 2 - 4
        );
        assert_eq!(
            output.decoded_frame.payload_bytes_hex,
            output.payload_bytes_hex
        );
    }

    #[test]
    fn warm_payload_v0_output_matches_committed_rust_artifact() {
        let output =
            fixture::generate_warm_payload_v0_output(default_warm_payload_fixture_dir()).unwrap();
        let actual = serde_json::to_value(&output).unwrap();
        let expected: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(default_warm_payload_fixture_dir().join("rust-warm-output.json"))
                .unwrap(),
        )
        .unwrap();

        assert!(
            json_equivalent(&actual, &expected),
            "Rust warm output did not match committed rust-warm-output.json\nactual: {actual}\nexpected: {expected}"
        );
    }
}
