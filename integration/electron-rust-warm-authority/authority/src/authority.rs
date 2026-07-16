use crate::contract::{
    ContractDefinition, CONTRACT_KEY, PROJECTION_INSTANCE_KEY, SEMANTIC_VERSION_HEX, STREAM_KEY,
    WARM_CODEC_VERSION_HEX,
};
use crate::deck_state::DeckState;
use crate::epoch::{canonical_authority_epoch, parse_canonical_u64_decimal};
use crate::messages::{
    authority_event, control_failure, control_success, decode_json, encode_json,
    encode_warm_publication_payload, extract_request_key, metrics_response, subscribe_result,
    unsubscribe_result, ControlRequestEnvelope, MetricsRequest, MetricsSnapshot, PublicationCredit,
    SetTempoRatioPayload, SubscribeRequestEnvelope, UnsubscribeRequestEnvelope,
    WarmPublicationAttachment, WarmPublicationDiagnostics, WarmPublicationMetadata, AUTHORITY_KEY,
    CONTROL_ENDPOINT_KEY, SET_TEMPO_RATIO_OPERATION_KEY,
};
use crate::wire::FrameKind;
use serde_json::{json, Value};
use std::collections::BTreeMap;
use warm_codec::frame::{encode_warm_lane_frame, WarmLaneFrame};
use warm_codec::hex;
use warm_codec::payload::encode_warm_snapshot_payload;

const BASELINE_EPOCH: u32 = 1;
const MAX_IN_FLIGHT_COUNT: u32 = 1;
const MAX_PENDING_COUNT: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OutboundMessage {
    pub kind: FrameKind,
    pub payload: Vec<u8>,
}

impl OutboundMessage {
    fn json(kind: FrameKind, value: &Value, label: &str) -> Result<Self, String> {
        Ok(Self {
            kind,
            payload: encode_json(value, label)?,
        })
    }
}

#[derive(Debug)]
pub(crate) enum PreparedControl {
    Response(OutboundMessage),
    SetTempoRatio {
        request_key: String,
        authority_epoch: u64,
        tempo_ratio: f64,
    },
}

#[derive(Debug)]
struct PendingPublication {
    sequence: u64,
    message: OutboundMessage,
}

#[derive(Debug)]
struct SubscriptionState {
    subscription_id: String,
    in_flight_sequence: Option<u64>,
    pending: Option<PendingPublication>,
    upstream_coalesced_publication_count: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionState {
    Starting,
    Ready,
}

#[derive(Debug)]
pub struct AuthorityCore {
    authority_epoch: u64,
    continuity_generation: u32,
    contract: ContractDefinition,
    session_state: SessionState,
    next_subscription_ordinal: u64,
    next_publication_sequence: u64,
    subscriptions: BTreeMap<String, SubscriptionState>,
    upstream_coalesced_publication_count: u64,
    latest_delivered_publication_sequence: Option<u64>,
    max_in_flight_count: u32,
    max_pending_count: u32,
}

impl AuthorityCore {
    pub fn new(
        authority_epoch: u64,
        continuity_generation: u32,
        contract: ContractDefinition,
    ) -> Result<Self, String> {
        if authority_epoch == 0 {
            return Err("authority epoch must be nonzero".to_string());
        }
        if continuity_generation == 0 {
            return Err("continuity generation must be nonzero".to_string());
        }
        Ok(Self {
            authority_epoch,
            continuity_generation,
            contract,
            session_state: SessionState::Starting,
            next_subscription_ordinal: 1,
            next_publication_sequence: 1,
            subscriptions: BTreeMap::new(),
            upstream_coalesced_publication_count: 0,
            latest_delivered_publication_sequence: None,
            max_in_flight_count: 0,
            max_pending_count: 0,
        })
    }

    pub fn authority_epoch(&self) -> u64 {
        self.authority_epoch
    }

    pub fn starting_message(&self) -> Result<OutboundMessage, String> {
        OutboundMessage::json(
            FrameKind::AuthorityStarting,
            &authority_event("authorityStarting", self.authority_epoch),
            "authority starting event",
        )
    }

    pub fn mark_ready(&mut self) -> Result<Option<OutboundMessage>, String> {
        if self.session_state == SessionState::Ready {
            return Ok(None);
        }
        self.session_state = SessionState::Ready;
        OutboundMessage::json(
            FrameKind::AuthorityReady,
            &authority_event("authorityReady", self.authority_epoch),
            "authority ready event",
        )
        .map(Some)
    }

    pub fn subscribe(
        &mut self,
        payload: &[u8],
        snapshot: &DeckState,
    ) -> Result<Vec<OutboundMessage>, String> {
        let request: SubscribeRequestEnvelope = decode_json(payload, "subscribe request")?;
        request.validate()?;
        let (expected_semantic_version, expected_lane_version) = request.expected_versions()?;

        if self.session_state == SessionState::Starting {
            return Ok(vec![OutboundMessage::json(
                FrameKind::SubscribeResult,
                &subscribe_result(
                    &request.request_key,
                    json!({
                        "ok": false,
                        "failure": { "kind": "authorityNotReady", "state": "starting" },
                    }),
                ),
                "subscribe result",
            )?]);
        }

        if request.request.lane != "warm" {
            let failure = if request.request.lane == "cold" {
                json!({
                    "kind": "coldLaneNotRatified",
                    "contractKey": request.request.contract_key,
                    "projectionInstanceKey": request.request.projection_instance_key,
                })
            } else {
                json!({
                    "kind": "notDeclaredLane",
                    "contractKey": request.request.contract_key,
                    "lane": request.request.lane,
                })
            };
            return self.single_subscribe_failure(&request.request_key, failure);
        }

        if request.request.contract_key != CONTRACT_KEY
            || request.request.projection_instance_key != PROJECTION_INSTANCE_KEY
        {
            return self.single_subscribe_failure(
                &request.request_key,
                json!({
                    "kind": "unknownSurface",
                    "contractKey": request.request.contract_key,
                    "projectionInstanceKey": request.request.projection_instance_key,
                }),
            );
        }

        if expected_semantic_version != self.contract.semantic_version
            || expected_lane_version != self.contract.warm_codec_version
        {
            return self.single_subscribe_failure(
                &request.request_key,
                json!({
                    "kind": "streamIncompatible",
                    "contractKey": CONTRACT_KEY,
                    "consumerSemanticVersion": request.request.expected_semantic_version,
                    "surfaceSemanticVersion": SEMANTIC_VERSION_HEX,
                    "consumerLaneVersion": request.request.expected_lane_version,
                    "surfaceLaneVersion": WARM_CODEC_VERSION_HEX,
                    "detail": "consumer expected versions do not match the publication surface",
                }),
            );
        }

        let subscription_id = format!(
            "deck-warm-{}-{}",
            self.authority_epoch, self.next_subscription_ordinal
        );
        self.next_subscription_ordinal = self
            .next_subscription_ordinal
            .checked_add(1)
            .ok_or_else(|| "subscription ordinal overflowed u64".to_string())?;

        let initial_sequence = self.take_next_publication_sequence()?;
        let initial_publication = build_warm_publication(
            &self.contract,
            self.authority_epoch,
            self.continuity_generation,
            &subscription_id,
            initial_sequence,
            0,
            snapshot,
        )?;
        let ack = json!({
            "contractKey": CONTRACT_KEY,
            "projectionInstanceKey": PROJECTION_INSTANCE_KEY,
            "lane": "warm",
            "subscriptionId": subscription_id,
            "authorityEpoch": canonical_authority_epoch(self.authority_epoch),
            "semanticVersion": SEMANTIC_VERSION_HEX,
            "laneVersion": WARM_CODEC_VERSION_HEX,
            "baselineEpoch": BASELINE_EPOCH,
            "continuityGeneration": self.continuity_generation,
        });
        let ack_message = OutboundMessage::json(
            FrameKind::SubscribeResult,
            &subscribe_result(&request.request_key, json!({ "ok": true, "ack": ack })),
            "subscribe result",
        )?;

        self.subscriptions.insert(
            subscription_id.clone(),
            SubscriptionState {
                subscription_id,
                in_flight_sequence: Some(initial_sequence),
                pending: None,
                upstream_coalesced_publication_count: 0,
            },
        );
        self.record_delivered(initial_sequence);
        self.max_in_flight_count = MAX_IN_FLIGHT_COUNT;

        Ok(vec![ack_message, initial_publication])
    }

    pub fn tick_publications(
        &mut self,
        snapshot: &DeckState,
    ) -> Result<Vec<OutboundMessage>, String> {
        if self.session_state != SessionState::Ready {
            return Ok(Vec::new());
        }
        if self.subscriptions.is_empty() {
            return Ok(Vec::new());
        }

        let sequence = self.take_next_publication_sequence()?;
        let authority_epoch = self.authority_epoch;
        let continuity_generation = self.continuity_generation;
        let contract = &self.contract;
        let mut delivered = false;
        let mut coalesced_increment = 0_u64;
        let mut outbound = Vec::new();

        for subscription in self.subscriptions.values_mut() {
            if subscription.in_flight_sequence.is_some() && subscription.pending.is_some() {
                subscription.upstream_coalesced_publication_count = subscription
                    .upstream_coalesced_publication_count
                    .checked_add(1)
                    .ok_or_else(|| "coalesced publication count overflowed u64".to_string())?;
                coalesced_increment = coalesced_increment.checked_add(1).ok_or_else(|| {
                    "global coalesced publication count overflowed u64".to_string()
                })?;
            }

            let message = build_warm_publication(
                contract,
                authority_epoch,
                continuity_generation,
                &subscription.subscription_id,
                sequence,
                subscription.upstream_coalesced_publication_count,
                snapshot,
            )?;

            if subscription.in_flight_sequence.is_none() {
                subscription.in_flight_sequence = Some(sequence);
                delivered = true;
                outbound.push(message);
            } else {
                subscription.pending = Some(PendingPublication { sequence, message });
                self.max_pending_count = MAX_PENDING_COUNT;
            }
        }

        self.upstream_coalesced_publication_count = self
            .upstream_coalesced_publication_count
            .checked_add(coalesced_increment)
            .ok_or_else(|| "global coalesced publication count overflowed u64".to_string())?;
        if delivered {
            self.record_delivered(sequence);
        }
        Ok(outbound)
    }

    pub fn apply_credit(&mut self, payload: &[u8]) -> Result<Option<OutboundMessage>, String> {
        let credit: PublicationCredit = decode_json(payload, "publication credit")?;
        credit.validate()?;
        let provided_epoch =
            parse_canonical_u64_decimal(&credit.authority_epoch, "authorityEpoch")?;
        let publication_sequence =
            hex::parse_u64_hex(&credit.publication_sequence, "publicationSequence")?;

        if provided_epoch != self.authority_epoch {
            return Ok(None);
        }
        let Some(subscription) = self.subscriptions.get_mut(&credit.subscription_id) else {
            return Ok(None);
        };
        if subscription.in_flight_sequence != Some(publication_sequence) {
            return Ok(None);
        }

        subscription.in_flight_sequence = None;
        let Some(pending) = subscription.pending.take() else {
            return Ok(None);
        };
        subscription.in_flight_sequence = Some(pending.sequence);
        self.record_delivered(pending.sequence);
        Ok(Some(pending.message))
    }

    pub fn unsubscribe(&mut self, payload: &[u8]) -> Result<OutboundMessage, String> {
        let request: UnsubscribeRequestEnvelope = decode_json(payload, "unsubscribe request")?;
        request.validate()?;
        let provided_epoch = parse_canonical_u64_decimal(
            &request.request.authority_epoch,
            "request.authorityEpoch",
        )?;

        let result = if self.session_state == SessionState::Starting {
            json!({
                "ok": false,
                "failure": { "kind": "authorityNotReady", "state": "starting" },
            })
        } else if provided_epoch != self.authority_epoch {
            json!({
                "ok": false,
                "failure": {
                    "kind": "sessionMismatch",
                    "expectedAuthorityEpoch": canonical_authority_epoch(self.authority_epoch),
                    "providedAuthorityEpoch": request.request.authority_epoch,
                },
            })
        } else if self
            .subscriptions
            .remove(&request.request.subscription_id)
            .is_some()
        {
            json!({ "ok": true })
        } else {
            json!({
                "ok": false,
                "failure": {
                    "kind": "requestIllegalInCurrentProductState",
                    "detail": format!(
                        "unknown subscriptionId {}",
                        request.request.subscription_id
                    ),
                },
            })
        };

        OutboundMessage::json(
            FrameKind::UnsubscribeResult,
            &unsubscribe_result(&request.request_key, result),
            "unsubscribe result",
        )
    }

    pub(crate) fn prepare_control(&self, payload: &[u8]) -> Result<PreparedControl, String> {
        let request_key = extract_request_key(payload, "control request")?;
        let request = match decode_json::<ControlRequestEnvelope>(payload, "control request") {
            Ok(request) => request,
            Err(error) => {
                return OutboundMessage::json(
                    FrameKind::ControlResponse,
                    &control_failure(&request_key, "control.invalidEnvelope", &error, None),
                    "control response",
                )
                .map(PreparedControl::Response)
            }
        };
        if let Err(error) = request.validate_outer() {
            return OutboundMessage::json(
                FrameKind::ControlResponse,
                &control_failure(&request_key, "control.invalidEnvelope", &error, None),
                "control response",
            )
            .map(PreparedControl::Response);
        }
        if request.operation_key != SET_TEMPO_RATIO_OPERATION_KEY {
            return OutboundMessage::json(
                FrameKind::ControlResponse,
                &control_failure(
                    &request_key,
                    "control.unsupportedOperation",
                    &format!("unsupported control operation {}", request.operation_key),
                    None,
                ),
                "control response",
            )
            .map(PreparedControl::Response);
        }

        let operation_payload =
            match serde_json::from_value::<SetTempoRatioPayload>(request.payload.clone()) {
                Ok(payload) => payload,
                Err(error) => {
                    return OutboundMessage::json(
                        FrameKind::ControlResponse,
                        &control_failure(
                            &request_key,
                            "control.invalidEnvelope",
                            &format!("invalid deck.setTempoRatio payload: {error}"),
                            None,
                        ),
                        "control response",
                    )
                    .map(PreparedControl::Response)
                }
            };
        let provided_epoch = match parse_canonical_u64_decimal(
            &operation_payload.authority_epoch,
            "payload.authorityEpoch",
        ) {
            Ok(epoch) => epoch,
            Err(error) => {
                return OutboundMessage::json(
                    FrameKind::ControlResponse,
                    &control_failure(&request_key, "control.invalidEnvelope", &error, None),
                    "control response",
                )
                .map(PreparedControl::Response)
            }
        };

        if self.session_state == SessionState::Starting {
            let details = json!({
                "reason": "bindingOpening",
                "rebindRequired": true,
                "binding": {
                    "authorityKey": AUTHORITY_KEY,
                    "surfaceKey": CONTROL_ENDPOINT_KEY,
                    "authorityEpoch": operation_payload.authority_epoch,
                },
            });
            return OutboundMessage::json(
                FrameKind::ControlResponse,
                &control_failure(
                    &request_key,
                    "control.bindingInvalid",
                    "Binding validity failure: bindingOpening",
                    Some(details),
                ),
                "control response",
            )
            .map(PreparedControl::Response);
        }

        if provided_epoch != self.authority_epoch {
            let details = json!({
                "reason": "authorityEpochMismatch",
                "rebindRequired": true,
                "binding": {
                    "authorityKey": AUTHORITY_KEY,
                    "surfaceKey": CONTROL_ENDPOINT_KEY,
                    "authorityEpoch": operation_payload.authority_epoch,
                },
                "expected": {
                    "authorityKey": AUTHORITY_KEY,
                    "surfaceKey": CONTROL_ENDPOINT_KEY,
                    "authorityEpoch": canonical_authority_epoch(self.authority_epoch),
                },
            });
            return OutboundMessage::json(
                FrameKind::ControlResponse,
                &control_failure(
                    &request_key,
                    "control.bindingInvalid",
                    "Binding validity failure: authorityEpochMismatch",
                    Some(details),
                ),
                "control response",
            )
            .map(PreparedControl::Response);
        }

        Ok(PreparedControl::SetTempoRatio {
            request_key,
            authority_epoch: self.authority_epoch,
            tempo_ratio: operation_payload.tempo_ratio,
        })
    }

    pub(crate) fn apply_prepared_control(
        prepared: PreparedControl,
        deck_state: &mut DeckState,
    ) -> Result<OutboundMessage, String> {
        let (request_key, authority_epoch, tempo_ratio) = match prepared {
            PreparedControl::Response(response) => return Ok(response),
            PreparedControl::SetTempoRatio {
                request_key,
                authority_epoch,
                tempo_ratio,
            } => (request_key, authority_epoch, tempo_ratio),
        };

        let applied_tempo_ratio = match deck_state.set_tempo_ratio(tempo_ratio) {
            Ok(value) => value,
            Err(error) => {
                return OutboundMessage::json(
                    FrameKind::ControlResponse,
                    &control_failure(&request_key, "control.rejected", &error, None),
                    "control response",
                );
            }
        };

        OutboundMessage::json(
            FrameKind::ControlResponse,
            &control_success(
                &request_key,
                json!({
                    "authorityEpoch": canonical_authority_epoch(authority_epoch),
                    "tempoRatio": applied_tempo_ratio,
                }),
            ),
            "control response",
        )
    }

    #[cfg(test)]
    fn control(
        &self,
        payload: &[u8],
        deck_state: &mut DeckState,
    ) -> Result<OutboundMessage, String> {
        let prepared = self.prepare_control(payload)?;
        Self::apply_prepared_control(prepared, deck_state)
    }

    pub fn metrics(&self, payload: &[u8]) -> Result<OutboundMessage, String> {
        let request: MetricsRequest = decode_json(payload, "metrics request")?;
        request.validate()?;
        let pending_count = self
            .subscriptions
            .values()
            .map(|subscription| u32::from(subscription.pending.is_some()))
            .max()
            .unwrap_or(0);
        let metrics = MetricsSnapshot {
            max_in_flight_count: self.max_in_flight_count,
            max_pending_count: self.max_pending_count,
            pending_count,
            upstream_coalesced_publication_count: self.upstream_coalesced_publication_count,
            latest_delivered_publication_sequence: self
                .latest_delivered_publication_sequence
                .map(hex::format_u64_hex),
        };
        OutboundMessage::json(
            FrameKind::MetricsResponse,
            &metrics_response(&request.request_key, metrics),
            "metrics response",
        )
    }

    fn single_subscribe_failure(
        &self,
        request_key: &str,
        failure: Value,
    ) -> Result<Vec<OutboundMessage>, String> {
        Ok(vec![OutboundMessage::json(
            FrameKind::SubscribeResult,
            &subscribe_result(request_key, json!({ "ok": false, "failure": failure })),
            "subscribe result",
        )?])
    }

    fn take_next_publication_sequence(&mut self) -> Result<u64, String> {
        let sequence = self.next_publication_sequence;
        self.next_publication_sequence = sequence
            .checked_add(1)
            .ok_or_else(|| "publication sequence overflowed u64".to_string())?;
        Ok(sequence)
    }

    fn record_delivered(&mut self, sequence: u64) {
        self.latest_delivered_publication_sequence = Some(
            self.latest_delivered_publication_sequence
                .map_or(sequence, |latest| latest.max(sequence)),
        );
    }
}

fn build_warm_publication(
    contract: &ContractDefinition,
    authority_epoch: u64,
    continuity_generation: u32,
    subscription_id: &str,
    publication_sequence: u64,
    upstream_coalesced_publication_count: u64,
    snapshot: &DeckState,
) -> Result<OutboundMessage, String> {
    let snapshot_json = snapshot.warm_snapshot_json()?;
    let snapshot_payload = encode_warm_snapshot_payload(&contract.warm_manifest, &snapshot_json)?;
    let warm_frame = WarmLaneFrame {
        contract_key: CONTRACT_KEY.to_string(),
        projection_instance_key: PROJECTION_INSTANCE_KEY.to_string(),
        semantic_version: contract.semantic_version,
        warm_codec_version: contract.warm_codec_version,
        baseline_epoch: BASELINE_EPOCH,
        continuity_generation,
        publication_sequence,
        lane_sequence: None,
        payload: snapshot_payload,
    };
    let warm_frame_bytes = encode_warm_lane_frame(&warm_frame)?;
    let metadata = WarmPublicationMetadata {
        attachment: WarmPublicationAttachment {
            kind: "publication.warmFrame".to_string(),
            attachment_version: 1,
            stream_key: STREAM_KEY.to_string(),
            subscription_id: subscription_id.to_string(),
            authority_epoch: canonical_authority_epoch(authority_epoch),
            contract_key: CONTRACT_KEY.to_string(),
            projection_instance_key: PROJECTION_INSTANCE_KEY.to_string(),
            lane: "warm".to_string(),
        },
        diagnostics: WarmPublicationDiagnostics {
            upstream_coalesced_publication_count,
        },
    };
    Ok(OutboundMessage {
        kind: FrameKind::WarmPublication,
        payload: encode_warm_publication_payload(&metadata, &warm_frame_bytes)?,
    })
}

#[cfg(test)]
mod tests {
    use super::{AuthorityCore, PreparedControl};
    use crate::contract::{
        ContractDefinition, CONTRACT_KEY, PROJECTION_INSTANCE_KEY, SEMANTIC_VERSION_HEX,
        WARM_CODEC_VERSION_HEX,
    };
    use crate::deck_state::DeckState;
    use crate::messages::{decode_warm_publication_payload, SET_TEMPO_RATIO_OPERATION_KEY};
    use crate::wire::FrameKind;
    use serde_json::{json, Value};
    use warm_codec::frame::decode_warm_lane_frame;
    use warm_codec::payload::decode_warm_snapshot_payload;

    fn core() -> AuthorityCore {
        AuthorityCore::new(42, 1, ContractDefinition::load_embedded().unwrap()).unwrap()
    }

    fn subscribe_payload(request_key: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "requestKey": request_key,
            "request": {
                "contractKey": CONTRACT_KEY,
                "projectionInstanceKey": PROJECTION_INSTANCE_KEY,
                "lane": "warm",
                "expectedSemanticVersion": SEMANTIC_VERSION_HEX,
                "expectedLaneVersion": WARM_CODEC_VERSION_HEX,
            },
        }))
        .unwrap()
    }

    fn json_payload(message: &super::OutboundMessage) -> Value {
        serde_json::from_slice(&message.payload).unwrap()
    }

    #[test]
    fn starting_session_rejects_epochless_subscribe_as_not_ready() {
        let mut core = core();
        let starting = core.starting_message().unwrap();
        let responses = core
            .subscribe(&subscribe_payload("early"), &DeckState::default())
            .unwrap();

        assert_eq!(starting.kind, FrameKind::AuthorityStarting);
        assert_eq!(
            json_payload(&starting),
            json!({ "kind": "authorityStarting", "authorityEpoch": "42" })
        );
        assert_eq!(responses.len(), 1);
        assert_eq!(
            json_payload(&responses[0])["result"]["failure"],
            json!({ "kind": "authorityNotReady", "state": "starting" })
        );
    }

    #[test]
    fn ready_precedes_ack_and_initial_complete_warm_snapshot() {
        let mut core = core();
        let ready = core.mark_ready().unwrap().unwrap();
        let snapshot = DeckState::default();
        let responses = core
            .subscribe(&subscribe_payload("subscribe-1"), &snapshot)
            .unwrap();

        assert_eq!(ready.kind, FrameKind::AuthorityReady);
        assert_eq!(responses.len(), 2);
        assert_eq!(responses[0].kind, FrameKind::SubscribeResult);
        assert_eq!(responses[1].kind, FrameKind::WarmPublication);
        assert_eq!(json_payload(&responses[0])["result"]["ok"], true);

        let publication = decode_warm_publication_payload(&responses[1].payload).unwrap();
        let frame = decode_warm_lane_frame(&publication.warm_frame_bytes).unwrap();
        let decoded_snapshot =
            decode_warm_snapshot_payload(&core.contract.warm_manifest, &frame.frame.payload)
                .unwrap();
        assert_eq!(frame.frame.publication_sequence, 1);
        assert_eq!(frame.frame.baseline_epoch, 1);
        assert_eq!(frame.frame.continuity_generation, 1);
        assert_eq!(decoded_snapshot, snapshot.warm_snapshot_json().unwrap());
    }

    #[test]
    fn process_continuity_generation_is_authoritative_in_ack_and_frames() {
        let mut core =
            AuthorityCore::new(42, 7, ContractDefinition::load_embedded().unwrap()).unwrap();
        core.mark_ready().unwrap();
        let responses = core
            .subscribe(&subscribe_payload("generation"), &DeckState::default())
            .unwrap();

        assert_eq!(
            json_payload(&responses[0])["result"]["ack"]["continuityGeneration"],
            7
        );
        let publication = decode_warm_publication_payload(&responses[1].payload).unwrap();
        let frame = decode_warm_lane_frame(&publication.warm_frame_bytes).unwrap();
        assert_eq!(frame.frame.continuity_generation, 7);
    }

    #[test]
    fn typed_tempo_control_succeeds_and_stale_epoch_is_binding_invalid() {
        let mut core = core();
        core.mark_ready().unwrap();
        let mut state = DeckState::default();
        let success = core
            .control(
                &serde_json::to_vec(&json!({
                    "kind": "control.request",
                    "envelopeVersion": 1,
                    "requestKey": "control-1",
                    "operationKey": SET_TEMPO_RATIO_OPERATION_KEY,
                    "payload": { "authorityEpoch": "42", "tempoRatio": 1.5 },
                }))
                .unwrap(),
                &mut state,
            )
            .unwrap();
        assert_eq!(json_payload(&success)["ok"], true);
        assert_eq!(state.tempo_ratio, 1.5);

        let stale = core
            .control(
                &serde_json::to_vec(&json!({
                    "kind": "control.request",
                    "envelopeVersion": 1,
                    "requestKey": "control-2",
                    "operationKey": SET_TEMPO_RATIO_OPERATION_KEY,
                    "payload": { "authorityEpoch": "41", "tempoRatio": 2.0 },
                }))
                .unwrap(),
                &mut state,
            )
            .unwrap();
        let stale_json = json_payload(&stale);
        assert_eq!(stale_json["failure"]["code"], "control.bindingInvalid");
        assert_eq!(
            stale_json["failure"]["details"]["binding"]["authorityEpoch"],
            "41"
        );
        assert_eq!(
            stale_json["failure"]["details"]["expected"]["authorityEpoch"],
            "42"
        );
        assert_eq!(state.tempo_ratio, 1.5);
    }

    #[test]
    fn tempo_control_reports_the_applied_f32_authority_value() {
        let mut core = core();
        core.mark_ready().unwrap();
        let mut state = DeckState::default();
        let requested = 1.234_567_890_123_f64;
        let expected_applied = requested as f32;
        assert_ne!(f64::from(expected_applied), requested);

        let response = core
            .control(
                &serde_json::to_vec(&json!({
                    "kind": "control.request",
                    "envelopeVersion": 1,
                    "requestKey": "control-f32",
                    "operationKey": SET_TEMPO_RATIO_OPERATION_KEY,
                    "payload": { "authorityEpoch": "42", "tempoRatio": requested },
                }))
                .unwrap(),
                &mut state,
            )
            .unwrap();

        assert_eq!(state.tempo_ratio, expected_applied);
        assert_eq!(
            json_payload(&response)["payload"]["tempoRatio"],
            json!(expected_applied)
        );
    }

    #[test]
    fn control_is_fully_prepared_before_deck_state_mutation() {
        let mut core = core();
        core.mark_ready().unwrap();
        let mut state = DeckState::default();
        let prepared = core
            .prepare_control(
                &serde_json::to_vec(&json!({
                    "kind": "control.request",
                    "envelopeVersion": 1,
                    "requestKey": "prepared-control",
                    "operationKey": SET_TEMPO_RATIO_OPERATION_KEY,
                    "payload": { "authorityEpoch": "42", "tempoRatio": 1.5 },
                }))
                .unwrap(),
            )
            .unwrap();

        assert!(matches!(&prepared, PreparedControl::SetTempoRatio { .. }));
        assert_eq!(state.tempo_ratio, 1.0);
        let response = AuthorityCore::apply_prepared_control(prepared, &mut state).unwrap();
        assert_eq!(json_payload(&response)["ok"], true);
        assert_eq!(state.tempo_ratio, 1.5);
    }

    #[test]
    fn tempo_control_rejects_extra_payload_keys_and_out_of_range_values() {
        let mut core = core();
        core.mark_ready().unwrap();
        let mut state = DeckState::default();
        let with_extra_key = core
            .control(
                &serde_json::to_vec(&json!({
                    "kind": "control.request",
                    "envelopeVersion": 1,
                    "requestKey": "extra",
                    "operationKey": SET_TEMPO_RATIO_OPERATION_KEY,
                    "payload": {
                        "authorityEpoch": "42",
                        "tempoRatio": 1.25,
                        "extra": true,
                    },
                }))
                .unwrap(),
                &mut state,
            )
            .unwrap();
        assert_eq!(
            json_payload(&with_extra_key)["failure"]["code"],
            "control.invalidEnvelope"
        );

        let out_of_range = core
            .control(
                &serde_json::to_vec(&json!({
                    "kind": "control.request",
                    "envelopeVersion": 1,
                    "requestKey": "range",
                    "operationKey": SET_TEMPO_RATIO_OPERATION_KEY,
                    "payload": { "authorityEpoch": "42", "tempoRatio": 2.5 },
                }))
                .unwrap(),
                &mut state,
            )
            .unwrap();
        assert_eq!(
            json_payload(&out_of_range)["failure"]["code"],
            "control.rejected"
        );
        assert_eq!(state.tempo_ratio, 1.0);
    }

    #[test]
    fn one_in_flight_and_one_latest_pending_survive_stale_credit() {
        let mut core = core();
        core.mark_ready().unwrap();
        let state = DeckState::default();
        let subscribed = core
            .subscribe(&subscribe_payload("subscribe"), &state)
            .unwrap();
        let subscription_id = json_payload(&subscribed[0])["result"]["ack"]["subscriptionId"]
            .as_str()
            .unwrap()
            .to_string();

        assert!(core.tick_publications(&state).unwrap().is_empty());
        assert!(core.tick_publications(&state).unwrap().is_empty());
        let metrics = core.metrics(br#"{"requestKey":"metrics"}"#).unwrap();
        let metrics_json = json_payload(&metrics);
        assert_eq!(metrics_json["metrics"]["maxInFlightCount"], 1);
        assert_eq!(metrics_json["metrics"]["maxPendingCount"], 1);
        assert_eq!(metrics_json["metrics"]["pendingCount"], 1);
        assert_eq!(
            metrics_json["metrics"]["upstreamCoalescedPublicationCount"],
            1
        );

        let stale_credit = serde_json::to_vec(&json!({
            "subscriptionId": subscription_id,
            "authorityEpoch": "41",
            "publicationSequence": "0000000000000001",
        }))
        .unwrap();
        assert!(core.apply_credit(&stale_credit).unwrap().is_none());

        let wrong_subscription_credit = serde_json::to_vec(&json!({
            "subscriptionId": "unknown-subscription",
            "authorityEpoch": "42",
            "publicationSequence": "0000000000000001",
        }))
        .unwrap();
        assert!(core
            .apply_credit(&wrong_subscription_credit)
            .unwrap()
            .is_none());

        let wrong_sequence_credit = serde_json::to_vec(&json!({
            "subscriptionId": subscription_id,
            "authorityEpoch": "42",
            "publicationSequence": "0000000000000002",
        }))
        .unwrap();
        assert!(core.apply_credit(&wrong_sequence_credit).unwrap().is_none());

        let matching_credit = serde_json::to_vec(&json!({
            "subscriptionId": subscription_id,
            "authorityEpoch": "42",
            "publicationSequence": "0000000000000001",
        }))
        .unwrap();
        let delivered = core.apply_credit(&matching_credit).unwrap().unwrap();
        let publication = decode_warm_publication_payload(&delivered.payload).unwrap();
        let frame = decode_warm_lane_frame(&publication.warm_frame_bytes).unwrap();
        assert_eq!(frame.frame.publication_sequence, 3);
        assert_eq!(
            publication
                .metadata
                .diagnostics
                .upstream_coalesced_publication_count,
            1
        );
    }

    #[test]
    fn unsubscribe_and_resubscribe_preserve_projection_scoped_sequence() {
        let mut core = core();
        core.mark_ready().unwrap();
        let state = DeckState::default();
        let first = core.subscribe(&subscribe_payload("first"), &state).unwrap();
        let first_id = json_payload(&first[0])["result"]["ack"]["subscriptionId"]
            .as_str()
            .unwrap()
            .to_string();
        let stale = core
            .unsubscribe(
                &serde_json::to_vec(&json!({
                    "requestKey": "stale-unsubscribe",
                    "request": { "subscriptionId": first_id, "authorityEpoch": "41" },
                }))
                .unwrap(),
            )
            .unwrap();
        assert_eq!(
            json_payload(&stale)["result"]["failure"],
            json!({
                "kind": "sessionMismatch",
                "expectedAuthorityEpoch": "42",
                "providedAuthorityEpoch": "41",
            })
        );
        let result = core
            .unsubscribe(
                &serde_json::to_vec(&json!({
                    "requestKey": "unsubscribe",
                    "request": { "subscriptionId": first_id, "authorityEpoch": "42" },
                }))
                .unwrap(),
            )
            .unwrap();
        assert_eq!(json_payload(&result)["result"]["ok"], true);

        let second = core
            .subscribe(&subscribe_payload("second"), &state)
            .unwrap();
        assert_ne!(
            json_payload(&first[0])["result"]["ack"]["subscriptionId"],
            json_payload(&second[0])["result"]["ack"]["subscriptionId"]
        );
        let first_publication = decode_warm_publication_payload(&first[1].payload).unwrap();
        let first_frame = decode_warm_lane_frame(&first_publication.warm_frame_bytes).unwrap();
        let second_publication = decode_warm_publication_payload(&second[1].payload).unwrap();
        let second_frame = decode_warm_lane_frame(&second_publication.warm_frame_bytes).unwrap();
        assert!(
            second_frame.frame.publication_sequence > first_frame.frame.publication_sequence,
            "a renderer resubscribe under one authority must not reset projection sequence"
        );
    }
}
