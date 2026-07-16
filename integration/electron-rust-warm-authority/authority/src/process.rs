use crate::authority::{AuthorityCore, OutboundMessage, PreparedControl};
use crate::contract::ContractDefinition;
use crate::deck_state::{spawn_engine_thread, DeckState};
use crate::epoch::{generate_authority_epoch, parse_nonzero_authority_epoch};
use crate::messages::{authority_event, encode_json, validate_shutdown_payload, AUTHORITY_KEY};
use crate::wire::{encode_stdio_frame, FrameKind, StdioFrame, StdioFrameDecoder};
use std::io::{self, BufWriter, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, SyncSender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

const PUBLICATION_PERIOD: Duration = Duration::from_millis(25);
const WORKER_POLL_PERIOD: Duration = Duration::from_millis(1);
const MAX_TEST_READY_DELAY: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessConfig {
    pub authority_epoch: u64,
    pub continuity_generation: u32,
    pub ready_delay: Duration,
}

impl ProcessConfig {
    pub fn from_args<I>(args: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = String>,
    {
        let mut integration_test_mode = false;
        let mut test_authority_epoch: Option<String> = None;
        let mut test_ready_delay_ms: Option<String> = None;
        let mut continuity_generation: Option<String> = None;
        let mut args = args.into_iter();

        while let Some(argument) = args.next() {
            match argument.as_str() {
                "--integration-test-mode" => {
                    if integration_test_mode {
                        return Err("--integration-test-mode must not be repeated".to_string());
                    }
                    integration_test_mode = true;
                }
                "--test-authority-epoch" => {
                    if test_authority_epoch.is_some() {
                        return Err("--test-authority-epoch must not be repeated".to_string());
                    }
                    test_authority_epoch = Some(args.next().ok_or_else(|| {
                        "--test-authority-epoch requires a decimal value".to_string()
                    })?);
                }
                "--ready-delay-ms" => {
                    if test_ready_delay_ms.is_some() {
                        return Err("--ready-delay-ms must not be repeated".to_string());
                    }
                    test_ready_delay_ms =
                        Some(args.next().ok_or_else(|| {
                            "--ready-delay-ms requires an integer value".to_string()
                        })?);
                }
                "--continuity-generation" => {
                    if continuity_generation.is_some() {
                        return Err("--continuity-generation must not be repeated".to_string());
                    }
                    continuity_generation = Some(args.next().ok_or_else(|| {
                        "--continuity-generation requires an integer value".to_string()
                    })?);
                }
                unknown => return Err(format!("unknown authority argument {unknown}")),
            }
        }

        if !integration_test_mode
            && (test_authority_epoch.is_some() || test_ready_delay_ms.is_some())
        {
            return Err("test authority options require --integration-test-mode".to_string());
        }

        let authority_epoch = match test_authority_epoch {
            Some(value) => parse_nonzero_authority_epoch(&value, "--test-authority-epoch")?,
            None => generate_authority_epoch(),
        };
        let continuity_generation = match continuity_generation {
            Some(value) => {
                if value.len() > 1 && value.starts_with('0') {
                    return Err(
                        "--continuity-generation must not contain leading zeroes".to_string()
                    );
                }
                let generation = value
                    .parse::<u32>()
                    .map_err(|_| "--continuity-generation must be a nonzero u32".to_string())?;
                if generation == 0 {
                    return Err("--continuity-generation must be a nonzero u32".to_string());
                }
                generation
            }
            None => 1,
        };
        let ready_delay = match test_ready_delay_ms {
            Some(value) => {
                if value.len() > 1 && value.starts_with('0') {
                    return Err("--ready-delay-ms must not contain leading zeroes".to_string());
                }
                let milliseconds = value
                    .parse::<u64>()
                    .map_err(|_| "--ready-delay-ms must be an unsigned integer".to_string())?;
                let delay = Duration::from_millis(milliseconds);
                if delay > MAX_TEST_READY_DELAY {
                    return Err(format!(
                        "--ready-delay-ms must be at most {}",
                        MAX_TEST_READY_DELAY.as_millis()
                    ));
                }
                delay
            }
            None => Duration::ZERO,
        };

        Ok(Self {
            authority_epoch,
            continuity_generation,
            ready_delay,
        })
    }

    #[cfg(test)]
    fn integration_test(authority_epoch: u64, ready_delay: Duration) -> Self {
        Self {
            authority_epoch,
            continuity_generation: 1,
            ready_delay,
        }
    }
}

#[derive(Clone)]
struct ProtocolWriter {
    inner: Arc<Mutex<Box<dyn Write + Send>>>,
}

enum InputEvent {
    Frame(StdioFrame),
    Finished(Result<(), String>),
}

struct InputLoopOutcome {
    result: Result<(), String>,
    input_thread_finished: bool,
}

impl ProtocolWriter {
    fn new<W>(writer: W) -> Self
    where
        W: Write + Send + 'static,
    {
        Self {
            inner: Arc::new(Mutex::new(Box::new(writer))),
        }
    }

    fn send(&self, message: &OutboundMessage) -> Result<(), String> {
        let bytes = encode_stdio_frame(message.kind, &message.payload)
            .map_err(|error| format!("failed to encode stdout protocol frame: {error}"))?;
        let mut writer = self
            .inner
            .lock()
            .map_err(|_| "stdout protocol writer mutex was poisoned".to_string())?;
        writer
            .write_all(&bytes)
            .map_err(|error| format!("failed to write stdout protocol frame: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("failed to flush stdout protocol frame: {error}"))
    }

    fn flush(&self) -> Result<(), String> {
        self.inner
            .lock()
            .map_err(|_| "stdout protocol writer mutex was poisoned".to_string())?
            .flush()
            .map_err(|error| format!("failed to flush stdout protocol: {error}"))
    }
}

pub fn run_stdio(config: ProcessConfig) -> Result<(), String> {
    run_with_io(io::stdin(), BufWriter::new(io::stdout()), config)
}

pub fn run_with_io<R, W>(input: R, output: W, config: ProcessConfig) -> Result<(), String>
where
    R: Read + Send + 'static,
    W: Write + Send + 'static,
{
    if config.authority_epoch == 0 {
        return Err("authority epoch must be nonzero".to_string());
    }
    let writer = ProtocolWriter::new(output);
    let starting_message = OutboundMessage {
        kind: FrameKind::AuthorityStarting,
        payload: encode_json(
            &authority_event("authorityStarting", config.authority_epoch),
            "authority starting event",
        )?,
    };
    writer.send(&starting_message)?;

    let contract = ContractDefinition::load_embedded()?;
    let deck_state = Arc::new(Mutex::new(DeckState::default()));
    let core = Arc::new(Mutex::new(AuthorityCore::new(
        config.authority_epoch,
        config.continuity_generation,
        contract,
    )?));
    let stop = Arc::new(AtomicBool::new(false));

    let engine_thread = spawn_engine_thread(Arc::clone(&deck_state), Arc::clone(&stop))?;
    let (worker_error_tx, worker_error_rx) = mpsc::sync_channel(1);
    let publication_thread = match spawn_publication_thread(
        Arc::clone(&core),
        Arc::clone(&deck_state),
        writer.clone(),
        Arc::clone(&stop),
        worker_error_tx,
        config.ready_delay,
    ) {
        Ok(thread) => thread,
        Err(error) => {
            stop.store(true, Ordering::Release);
            let _ = engine_thread.join();
            return Err(error);
        }
    };

    let (input_event_rx, input_thread) = match spawn_input_thread(input) {
        Ok(input) => input,
        Err(error) => {
            stop.store(true, Ordering::Release);
            let _ = join_worker(engine_thread, "deck engine");
            let _ = join_worker(publication_thread, "warm publication");
            return Err(error);
        }
    };
    let input_outcome = run_input_loop(
        &input_event_rx,
        &core,
        &deck_state,
        &writer,
        &worker_error_rx,
    );
    drop(input_event_rx);
    stop.store(true, Ordering::Release);

    let input_join = if input_outcome.input_thread_finished {
        join_worker(input_thread, "stdin protocol")
    } else {
        drop(input_thread);
        Ok(())
    };
    let engine_join = join_worker(engine_thread, "deck engine");
    let publication_join = join_worker(publication_thread, "warm publication");
    let flush_result = writer.flush();
    let worker_result = match worker_error_rx.try_recv() {
        Ok(error) => Err(error),
        Err(TryRecvError::Empty | TryRecvError::Disconnected) => Ok(()),
    };

    input_outcome
        .result
        .and(input_join)
        .and(engine_join)
        .and(publication_join)
        .and(worker_result)
        .and(flush_result)
}

fn run_input_loop(
    input_event_rx: &Receiver<InputEvent>,
    core: &Arc<Mutex<AuthorityCore>>,
    deck_state: &Arc<Mutex<DeckState>>,
    writer: &ProtocolWriter,
    worker_error_rx: &Receiver<String>,
) -> InputLoopOutcome {
    loop {
        match worker_error_rx.try_recv() {
            Ok(error) => {
                return InputLoopOutcome {
                    result: Err(error),
                    input_thread_finished: false,
                }
            }
            Err(TryRecvError::Disconnected) => {
                return InputLoopOutcome {
                    result: Err("warm publication worker ended unexpectedly".to_string()),
                    input_thread_finished: false,
                }
            }
            Err(TryRecvError::Empty) => {}
        }

        match input_event_rx.recv_timeout(WORKER_POLL_PERIOD) {
            Ok(InputEvent::Frame(frame)) => {
                match handle_inbound_frame(frame, core, deck_state, writer) {
                    Ok(true) => {
                        return InputLoopOutcome {
                            result: Ok(()),
                            input_thread_finished: true,
                        }
                    }
                    Ok(false) => {}
                    Err(error) => {
                        return InputLoopOutcome {
                            result: Err(error),
                            input_thread_finished: false,
                        }
                    }
                }
            }
            Ok(InputEvent::Finished(result)) => {
                return InputLoopOutcome {
                    result,
                    input_thread_finished: true,
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                return InputLoopOutcome {
                    result: Err("stdin protocol worker ended unexpectedly".to_string()),
                    input_thread_finished: true,
                }
            }
        }
    }
}

fn spawn_input_thread<R>(mut input: R) -> Result<(Receiver<InputEvent>, JoinHandle<()>), String>
where
    R: Read + Send + 'static,
{
    let (input_event_tx, input_event_rx) = mpsc::sync_channel(1);
    let thread = thread::Builder::new()
        .name("stdin-protocol".to_string())
        .spawn(move || {
            let mut decoder = StdioFrameDecoder::new();
            let mut read_buffer = [0_u8; 8192];
            loop {
                let byte_length = match input.read(&mut read_buffer) {
                    Ok(byte_length) => byte_length,
                    Err(error) => {
                        let _ = input_event_tx.send(InputEvent::Finished(Err(format!(
                            "failed to read stdin protocol bytes: {error}"
                        ))));
                        return;
                    }
                };
                if byte_length == 0 {
                    let result = decoder
                        .finish()
                        .map_err(|error| format!("stdin protocol error: {error}"));
                    let _ = input_event_tx.send(InputEvent::Finished(result));
                    return;
                }
                let frames = match decoder.push(&read_buffer[..byte_length]) {
                    Ok(frames) => frames,
                    Err(error) => {
                        let _ = input_event_tx.send(InputEvent::Finished(Err(format!(
                            "stdin protocol error: {error}"
                        ))));
                        return;
                    }
                };
                for frame in frames {
                    let shutdown = frame.kind == FrameKind::Shutdown;
                    if input_event_tx.send(InputEvent::Frame(frame)).is_err() {
                        return;
                    }
                    if shutdown {
                        return;
                    }
                }
            }
        })
        .map_err(|error| format!("failed to spawn stdin protocol thread: {error}"))?;
    Ok((input_event_rx, thread))
}

fn handle_inbound_frame(
    frame: StdioFrame,
    core: &Arc<Mutex<AuthorityCore>>,
    deck_state: &Arc<Mutex<DeckState>>,
    writer: &ProtocolWriter,
) -> Result<bool, String> {
    match frame.kind {
        FrameKind::SubscribeRequest => {
            let mut core = core
                .lock()
                .map_err(|_| "authority core mutex was poisoned".to_string())?;
            let snapshot = deck_state
                .lock()
                .map_err(|_| "deck state mutex was poisoned".to_string())?
                .clone();
            for message in core.subscribe(&frame.payload, &snapshot)? {
                writer.send(&message)?;
            }
            Ok(false)
        }
        FrameKind::ControlRequest => {
            let prepared = core
                .lock()
                .map_err(|_| "authority core mutex was poisoned".to_string())?
                .prepare_control(&frame.payload)?;
            let response = match prepared {
                PreparedControl::Response(response) => response,
                command @ PreparedControl::SetTempoRatio { .. } => {
                    let mut state = deck_state
                        .lock()
                        .map_err(|_| "deck state mutex was poisoned".to_string())?;
                    AuthorityCore::apply_prepared_control(command, &mut state)?
                }
            };
            writer.send(&response)?;
            Ok(false)
        }
        FrameKind::PublicationCredit => {
            let mut core = core
                .lock()
                .map_err(|_| "authority core mutex was poisoned".to_string())?;
            if let Some(message) = core.apply_credit(&frame.payload)? {
                writer.send(&message)?;
            }
            Ok(false)
        }
        FrameKind::MetricsRequest => {
            let core = core
                .lock()
                .map_err(|_| "authority core mutex was poisoned".to_string())?;
            writer.send(&core.metrics(&frame.payload)?)?;
            Ok(false)
        }
        FrameKind::Shutdown => {
            validate_shutdown_payload(&frame.payload)?;
            Ok(true)
        }
        FrameKind::UnsubscribeRequest => {
            let mut core = core
                .lock()
                .map_err(|_| "authority core mutex was poisoned".to_string())?;
            writer.send(&core.unsubscribe(&frame.payload)?)?;
            Ok(false)
        }
        unexpected => Err(format!(
            "unexpected inbound stdio frame kind {} for {AUTHORITY_KEY}",
            unexpected as u16
        )),
    }
}

fn spawn_publication_thread(
    core: Arc<Mutex<AuthorityCore>>,
    deck_state: Arc<Mutex<DeckState>>,
    writer: ProtocolWriter,
    stop: Arc<AtomicBool>,
    worker_error_tx: SyncSender<String>,
    ready_delay: Duration,
) -> Result<JoinHandle<()>, String> {
    thread::Builder::new()
        .name("warm-publication".to_string())
        .spawn(move || {
            let ready_at = Instant::now() + ready_delay;
            let mut ready_sent = false;
            let mut next_publication_at = ready_at + PUBLICATION_PERIOD;

            while !stop.load(Ordering::Acquire) {
                let now = Instant::now();
                let result = if !ready_sent && now >= ready_at {
                    let mut core = core.lock().map_err(|_| {
                        "authority core mutex was poisoned in publication thread".to_string()
                    });
                    match core.as_mut() {
                        Ok(core) => match core.mark_ready() {
                            Ok(Some(message)) => writer.send(&message),
                            Ok(None) => Ok(()),
                            Err(error) => Err(error),
                        },
                        Err(error) => Err(error.clone()),
                    }
                } else if ready_sent && now >= next_publication_at {
                    let mut core = core.lock().map_err(|_| {
                        "authority core mutex was poisoned in publication thread".to_string()
                    });
                    match core.as_mut() {
                        Ok(core) => {
                            let snapshot = deck_state
                                .lock()
                                .map_err(|_| {
                                    "deck state mutex was poisoned in publication thread"
                                        .to_string()
                                })
                                .map(|state| state.clone());
                            match snapshot {
                                Ok(snapshot) => match core.tick_publications(&snapshot) {
                                    Ok(messages) => {
                                        messages.iter().try_for_each(|message| writer.send(message))
                                    }
                                    Err(error) => Err(error),
                                },
                                Err(error) => Err(error),
                            }
                        }
                        Err(error) => Err(error.clone()),
                    }
                } else {
                    Ok(())
                };

                if let Err(error) = result {
                    let _ = worker_error_tx.try_send(error);
                    stop.store(true, Ordering::Release);
                    break;
                }
                if !ready_sent && now >= ready_at {
                    ready_sent = true;
                    next_publication_at = Instant::now() + PUBLICATION_PERIOD;
                } else if ready_sent && now >= next_publication_at {
                    next_publication_at = Instant::now() + PUBLICATION_PERIOD;
                }
                thread::sleep(WORKER_POLL_PERIOD);
            }
        })
        .map_err(|error| format!("failed to spawn warm publication thread: {error}"))
}

fn join_worker(thread: JoinHandle<()>, label: &str) -> Result<(), String> {
    thread
        .join()
        .map_err(|_| format!("{label} thread panicked during shutdown"))
}

#[cfg(test)]
mod tests {
    use super::{run_with_io, ProcessConfig};
    use crate::contract::{
        CONTRACT_KEY, PROJECTION_INSTANCE_KEY, SEMANTIC_VERSION_HEX, WARM_CODEC_VERSION_HEX,
    };
    use crate::wire::{encode_stdio_frame, FrameKind, StdioFrameDecoder};
    use serde_json::json;
    use std::io::{Cursor, Read, Write};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Condvar, Mutex};
    use std::thread;
    use std::time::Duration;

    #[derive(Clone, Default)]
    struct CaptureWriter {
        bytes: Arc<Mutex<Vec<u8>>>,
    }

    impl Write for CaptureWriter {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            self.bytes.lock().unwrap().extend_from_slice(buffer);
            Ok(buffer.len())
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl CaptureWriter {
        fn decode(&self) -> Vec<crate::wire::StdioFrame> {
            let bytes = self.bytes.lock().unwrap().clone();
            let mut decoder = StdioFrameDecoder::new();
            let frames = decoder.push(&bytes).unwrap();
            decoder.finish().unwrap();
            frames
        }
    }

    #[derive(Clone)]
    struct SignalingWriter {
        capture: CaptureWriter,
        write_signal: mpsc::SyncSender<()>,
    }

    struct QuietUntilReleasedReader {
        release: Arc<(Mutex<bool>, Condvar)>,
        finished: mpsc::SyncSender<()>,
        waited: bool,
    }

    impl Read for QuietUntilReleasedReader {
        fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
            if !self.waited {
                let (released, wake) = &*self.release;
                let mut released = released.lock().unwrap();
                while !*released {
                    released = wake.wait(released).unwrap();
                }
                self.waited = true;
                let _ = self.finished.send(());
            }
            Ok(0)
        }
    }

    #[derive(Clone, Default)]
    struct FailAfterFirstWrite {
        write_count: Arc<AtomicUsize>,
    }

    impl Write for FailAfterFirstWrite {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            if self.write_count.fetch_add(1, Ordering::SeqCst) == 0 {
                Ok(buffer.len())
            } else {
                Err(std::io::Error::other("simulated stdout failure"))
            }
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    impl Write for SignalingWriter {
        fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
            let byte_length = self.capture.clone().write(buffer)?;
            let _ = self.write_signal.try_send(());
            Ok(byte_length)
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn cli_test_epoch_and_ready_delay_require_explicit_test_mode() {
        assert!(ProcessConfig::from_args(
            ["--test-authority-epoch".to_string(), "42".to_string(),]
        )
        .is_err());
        let config = ProcessConfig::from_args([
            "--integration-test-mode".to_string(),
            "--test-authority-epoch".to_string(),
            "42".to_string(),
            "--ready-delay-ms".to_string(),
            "25".to_string(),
            "--continuity-generation".to_string(),
            "2".to_string(),
        ])
        .unwrap();
        assert_eq!(config.authority_epoch, 42);
        assert_eq!(config.continuity_generation, 2);
        assert_eq!(config.ready_delay, Duration::from_millis(25));
    }

    #[test]
    fn early_subscribe_is_processed_while_test_ready_delay_is_active() {
        let subscribe = serde_json::to_vec(&json!({
            "requestKey": "early",
            "request": {
                "contractKey": CONTRACT_KEY,
                "projectionInstanceKey": PROJECTION_INSTANCE_KEY,
                "lane": "warm",
                "expectedSemanticVersion": SEMANTIC_VERSION_HEX,
                "expectedLaneVersion": WARM_CODEC_VERSION_HEX,
            },
        }))
        .unwrap();
        let mut input = encode_stdio_frame(FrameKind::SubscribeRequest, &subscribe).unwrap();
        input.extend_from_slice(&encode_stdio_frame(FrameKind::Shutdown, b"{}").unwrap());
        let output = CaptureWriter::default();

        run_with_io(
            Cursor::new(input),
            output.clone(),
            ProcessConfig::integration_test(42, Duration::from_millis(100)),
        )
        .unwrap();
        let frames = output.decode();
        assert_eq!(frames[0].kind, FrameKind::AuthorityStarting);
        assert_eq!(frames[1].kind, FrameKind::SubscribeResult);
        let failure: serde_json::Value = serde_json::from_slice(&frames[1].payload).unwrap();
        assert_eq!(failure["result"]["failure"]["kind"], "authorityNotReady");
        assert!(!frames
            .iter()
            .any(|frame| frame.kind == FrameKind::AuthorityReady));
    }

    #[test]
    fn ready_event_follows_starting_after_runtime_initialization() {
        let output = CaptureWriter::default();
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let (reader_finished_tx, _reader_finished_rx) = mpsc::sync_channel(1);
        let (write_tx, write_rx) = mpsc::sync_channel(2);
        let runner = thread::spawn({
            let release = Arc::clone(&release);
            let output = output.clone();
            move || {
                run_with_io(
                    QuietUntilReleasedReader {
                        release,
                        finished: reader_finished_tx,
                        waited: false,
                    },
                    SignalingWriter {
                        capture: output,
                        write_signal: write_tx,
                    },
                    ProcessConfig::integration_test(43, Duration::ZERO),
                )
            }
        });
        write_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("authorityStarting was not written");
        write_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("authorityReady was not written");
        let (released, wake) = &*release;
        *released.lock().unwrap() = true;
        wake.notify_all();
        runner.join().unwrap().unwrap();
        let frames = output.decode();
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0].kind, FrameKind::AuthorityStarting);
        assert_eq!(frames[1].kind, FrameKind::AuthorityReady);
    }

    #[test]
    fn eof_and_explicit_shutdown_stop_and_join_workers_cleanly() {
        let eof_output = CaptureWriter::default();
        run_with_io(
            Cursor::new(Vec::<u8>::new()),
            eof_output.clone(),
            ProcessConfig::integration_test(7, Duration::from_millis(100)),
        )
        .unwrap();
        assert_eq!(eof_output.decode()[0].kind, FrameKind::AuthorityStarting);

        let shutdown_output = CaptureWriter::default();
        let shutdown = encode_stdio_frame(FrameKind::Shutdown, b"{}").unwrap();
        run_with_io(
            Cursor::new(shutdown),
            shutdown_output.clone(),
            ProcessConfig::integration_test(8, Duration::from_millis(100)),
        )
        .unwrap();
        assert_eq!(
            shutdown_output.decode()[0].kind,
            FrameKind::AuthorityStarting
        );
    }

    #[test]
    fn truncated_eof_is_reported_after_workers_are_stopped() {
        let mut shutdown = encode_stdio_frame(FrameKind::Shutdown, b"{}").unwrap();
        shutdown.pop();
        let error = run_with_io(
            Cursor::new(shutdown),
            CaptureWriter::default(),
            ProcessConfig::integration_test(9, Duration::from_millis(100)),
        )
        .unwrap_err();
        assert!(error.contains("truncated stdio frame at EOF"));
    }

    #[test]
    fn publication_worker_failure_wakes_a_coordinator_with_quiet_stdin() {
        let release = Arc::new((Mutex::new(false), Condvar::new()));
        let (reader_finished_tx, reader_finished_rx) = mpsc::sync_channel(1);
        let (result_tx, result_rx) = mpsc::sync_channel(1);
        let runner = thread::spawn({
            let release = Arc::clone(&release);
            move || {
                let result = run_with_io(
                    QuietUntilReleasedReader {
                        release,
                        finished: reader_finished_tx,
                        waited: false,
                    },
                    FailAfterFirstWrite::default(),
                    ProcessConfig::integration_test(10, Duration::ZERO),
                );
                result_tx.send(result).unwrap();
            }
        });

        let result = result_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("publication failure did not wake the coordinator");
        assert!(result.unwrap_err().contains("simulated stdout failure"));

        let (released, wake) = &*release;
        *released.lock().unwrap() = true;
        wake.notify_all();
        reader_finished_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("detached stdin reader did not finish after release");
        runner.join().unwrap();
    }
}
