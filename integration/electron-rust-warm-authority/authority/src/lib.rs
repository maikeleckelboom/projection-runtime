pub mod authority;
pub mod contract;
pub mod deck_state;
pub mod epoch;
pub mod generated_deck_runtime {
    include!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../fixtures/projection-runtime/deck-runtime-v0/generated/warm_snapshot.rs"
    ));
}
pub mod messages;
pub mod process;
pub mod wire;
