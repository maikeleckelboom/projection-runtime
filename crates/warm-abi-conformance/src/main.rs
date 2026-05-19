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
    use std::fs;

    #[test]
    fn warm_payload_v0_matches_committed_payload_and_frame_bytes() {
        let output =
            fixture::generate_warm_payload_v0_output(default_warm_payload_fixture_dir()).unwrap();

        assert_eq!(output.fixture_kind, "rust-warm-output");
        assert_eq!(output.fixture_name, "warm-payload-v0");
        assert_eq!(output.contract_key, "fixture.warmPayload.v0");
        assert_eq!(
            output.payload_bytes_hex,
            "012a0000000000003f0000803f0200000005000000616c706861010000004105000000627261766f0100000042020000000700000405000000726561647903006d69780200000061000000016200000002020500436166c3a9"
        );
        assert_eq!(
            output.frame_bytes_hex,
            "b800000016000000666978747572652e7761726d5061796c6f61642e7630180000007761726d2d7061796c6f61642d76302e696e7374616e63657912307751e2fb10c554d69372e4b96307000000030000002a00000000000000010000000059000000012a0000000000003f0000803f0200000005000000616c706861010000004105000000627261766f0100000042020000000700000405000000726561647903006d69780200000061000000016200000002020500436166c3a9"
        );
        assert_eq!(output.decoded_frame.frame_byte_length, 184);
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
