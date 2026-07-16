use crate::generated_deck_runtime::{
    DeckRuntimeTransportState, DeckRuntimeWarmSnapshot, STEM_GAINS_MAX_LENGTH,
};
use serde_json::Value;
use std::f64::consts::TAU;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::SyncSender;
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};
use warm_codec::hex;

const ENGINE_PERIOD: Duration = Duration::from_millis(10);
const SAMPLE_RATE: f64 = 48_000.0;
const BASE_BEATS_PER_SECOND: f64 = 2.0;

#[derive(Debug, Clone, PartialEq)]
pub struct DeckState {
    pub beat_phase01: f32,
    pub level: f32,
    pub loop_active: bool,
    pub media_time_seconds: f64,
    pub sample_position: u64,
    pub stem_gains: [f32; STEM_GAINS_MAX_LENGTH],
    pub tempo_ratio: f32,
    pub transport_state: DeckRuntimeTransportState,
}

impl Default for DeckState {
    fn default() -> Self {
        Self {
            beat_phase01: 0.0,
            level: 0.0,
            loop_active: false,
            media_time_seconds: 0.0,
            sample_position: 0,
            stem_gains: [1.0; STEM_GAINS_MAX_LENGTH],
            tempo_ratio: 1.0,
            transport_state: DeckRuntimeTransportState::Playing,
        }
    }
}

impl DeckState {
    pub fn set_tempo_ratio(&mut self, tempo_ratio: f64) -> Result<f32, String> {
        if !tempo_ratio.is_finite() || !(0.5..=2.0).contains(&tempo_ratio) {
            return Err("tempoRatio must be finite and within 0.5..=2.0".to_string());
        }
        self.tempo_ratio = tempo_ratio as f32;
        Ok(self.tempo_ratio)
    }

    pub fn advance(&mut self, elapsed: Duration) {
        if self.transport_state != DeckRuntimeTransportState::Playing {
            return;
        }

        let elapsed_seconds = elapsed.as_secs_f64();
        let media_delta = elapsed_seconds * f64::from(self.tempo_ratio);
        self.media_time_seconds += media_delta;
        self.sample_position = self
            .sample_position
            .saturating_add((elapsed_seconds * SAMPLE_RATE).round() as u64);

        let phase =
            (f64::from(self.beat_phase01) + media_delta * BASE_BEATS_PER_SECOND).rem_euclid(1.0);
        self.beat_phase01 = phase as f32;
        self.level = (0.15 + 0.8 * (phase * TAU).sin().abs()).min(1.0) as f32;
    }

    pub fn warm_snapshot_json(&self) -> Result<Value, String> {
        let sample_position = hex::format_u64_hex(self.sample_position);
        serde_json::to_value(DeckRuntimeWarmSnapshot {
            beat_phase01: self.beat_phase01,
            level: self.level,
            loop_active: self.loop_active,
            media_time_seconds: self.media_time_seconds,
            sample_position: &sample_position,
            stem_gains: &self.stem_gains,
            tempo_ratio: self.tempo_ratio,
            transport_state: self.transport_state,
        })
        .map_err(|error| format!("generated deck warm snapshot serialization failed: {error}"))
    }
}

pub fn spawn_engine_thread(
    state: Arc<Mutex<DeckState>>,
    stop: Arc<AtomicBool>,
) -> Result<JoinHandle<()>, String> {
    spawn_engine_thread_with_tick_signal(state, stop, None)
}

fn spawn_engine_thread_with_tick_signal(
    state: Arc<Mutex<DeckState>>,
    stop: Arc<AtomicBool>,
    tick_signal: Option<SyncSender<()>>,
) -> Result<JoinHandle<()>, String> {
    thread::Builder::new()
        .name("deck-engine".to_string())
        .spawn(move || {
            let mut previous = Instant::now();
            while !stop.load(Ordering::Acquire) {
                thread::sleep(ENGINE_PERIOD);
                let now = Instant::now();
                let elapsed = now.saturating_duration_since(previous);
                previous = now;
                let mut state = state
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                state.advance(elapsed);
                drop(state);
                if let Some(signal) = &tick_signal {
                    let _ = signal.try_send(());
                }
            }
        })
        .map_err(|error| format!("failed to spawn deck engine thread: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{spawn_engine_thread_with_tick_signal, DeckState};
    use crate::generated_deck_runtime::{DeckRuntimeTransportState, STEM_GAINS_MAX_LENGTH};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    #[test]
    fn deck_starts_playing_with_unity_tempo_and_stems() {
        let state = DeckState::default();

        assert_eq!(state.transport_state, DeckRuntimeTransportState::Playing);
        assert_eq!(state.tempo_ratio, 1.0);
        assert_eq!(state.stem_gains, [1.0; STEM_GAINS_MAX_LENGTH]);
    }

    #[test]
    fn engine_advance_and_typed_tempo_control_mutate_rust_state() {
        let mut state = DeckState::default();
        state.set_tempo_ratio(1.5).unwrap();
        state.advance(Duration::from_millis(10));

        assert_eq!(state.tempo_ratio, 1.5);
        assert_eq!(state.sample_position, 480);
        assert!(state.media_time_seconds > 0.014);
        assert!(state.beat_phase01 > 0.0);
        assert!(state.level > 0.0);
        assert!(state.set_tempo_ratio(2.01).is_err());
        assert!(state.set_tempo_ratio(f64::NAN).is_err());
    }

    #[test]
    fn engine_thread_advances_without_any_subscription_or_delivery_work() {
        let state = Arc::new(Mutex::new(DeckState::default()));
        let stop = Arc::new(AtomicBool::new(false));
        let (tick_tx, tick_rx) = mpsc::sync_channel(1);
        let thread = spawn_engine_thread_with_tick_signal(
            Arc::clone(&state),
            Arc::clone(&stop),
            Some(tick_tx),
        )
        .unwrap();

        tick_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("engine thread did not report its first tick");
        stop.store(true, Ordering::Release);
        thread.join().unwrap();

        assert!(state.lock().unwrap().sample_position > 0);
    }
}
