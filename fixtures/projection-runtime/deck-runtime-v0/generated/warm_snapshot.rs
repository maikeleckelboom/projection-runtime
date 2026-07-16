// Generated from fixtures/projection-runtime/deck-runtime-v0/resolved-contract.json. Do not edit by hand.

pub const CONTRACT_KEY: &str = "fixture.deckRuntime";
pub const SEMANTIC_VERSION_HEX: &str = "e3636f7cdffa73b2";
pub const WARM_CODEC_VERSION_HEX: &str = "712fca42549416de";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DeckRuntimeWarmFieldIdentity {
    pub dot_path: &'static str,
    pub field_id: u32,
}

pub const DECK_RUNTIME_WARM_FIELDS: [DeckRuntimeWarmFieldIdentity; 8] = [
    DeckRuntimeWarmFieldIdentity {
        dot_path: "beatPhase01",
        field_id: 3213911613,
    },
    DeckRuntimeWarmFieldIdentity {
        dot_path: "level",
        field_id: 2921991399,
    },
    DeckRuntimeWarmFieldIdentity {
        dot_path: "loopActive",
        field_id: 2600609301,
    },
    DeckRuntimeWarmFieldIdentity {
        dot_path: "mediaTimeSeconds",
        field_id: 714320550,
    },
    DeckRuntimeWarmFieldIdentity {
        dot_path: "samplePosition",
        field_id: 1487766962,
    },
    DeckRuntimeWarmFieldIdentity {
        dot_path: "stemGains",
        field_id: 1302981354,
    },
    DeckRuntimeWarmFieldIdentity {
        dot_path: "tempoRatio",
        field_id: 3925450382,
    },
    DeckRuntimeWarmFieldIdentity {
        dot_path: "transportState",
        field_id: 1379000454,
    },
];

#[derive(Clone, Copy, Debug, Eq, PartialEq, serde::Serialize)]
pub enum DeckRuntimeTransportState {
    #[serde(rename = "stopped")]
    Stopped,
    #[serde(rename = "cueing")]
    Cueing,
    #[serde(rename = "playing")]
    Playing,
    #[serde(rename = "paused")]
    Paused,
}

#[derive(Debug, serde::Serialize)]
pub struct DeckRuntimeWarmSnapshot<'a> {
    #[serde(rename = "beatPhase01")]
    pub beat_phase01: f32,
    #[serde(rename = "level")]
    pub level: f32,
    #[serde(rename = "loopActive")]
    pub loop_active: bool,
    #[serde(rename = "mediaTimeSeconds")]
    pub media_time_seconds: f64,
    #[serde(rename = "samplePosition")]
    pub sample_position: &'a str,
    #[serde(rename = "stemGains")]
    pub stem_gains: &'a [f32],
    #[serde(rename = "tempoRatio")]
    pub tempo_ratio: f32,
    #[serde(rename = "transportState")]
    pub transport_state: DeckRuntimeTransportState,
}

pub const STEM_GAINS_MAX_LENGTH: usize = 4;
