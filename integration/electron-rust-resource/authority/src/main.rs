//! Private executable fixture adapter. stdout = bounded metadata, stderr = binary.
//! No audio authority or arbitrary file/path capability. Product adapters own grants.
use authority_session::{generate_authority_epoch, parse_canonical_u64_decimal};
use resource_runtime::{wire, Limits, ResourceAuthority, Transfer};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{self, BufRead, BufReader, Read, Write};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Instant;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    kind: String,
    envelope_version: u32,
    request_key: String,
    operation_key: String,
    payload: Payload,
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Payload {
    #[serde(default)]
    client: String,
    #[serde(default)]
    authority_epoch: String,
    #[serde(default)]
    handle_id: String,
    #[serde(default)]
    resource_key: String,
    #[serde(default)]
    offset_bytes: String,
    #[serde(default)]
    length_bytes: usize,
    #[serde(default)]
    transfer_id: String,
    #[serde(default)]
    protocol_version: u32,
    #[serde(default)]
    priority: String,
}

struct Work {
    transfer: Transfer,
    visible: bool,
}
fn next_work(queue: &mut VecDeque<Work>, streak: &mut usize) -> Option<Work> {
    let background = queue.iter().position(|w| !w.visible);
    let visible = queue.iter().position(|w| w.visible);
    let index = if *streak >= 3 {
        background.or(visible)
    } else {
        visible.or(background)
    }?;
    let work = queue.remove(index)?;
    if work.visible {
        *streak = (*streak + 1).min(3);
    } else {
        *streak = 0;
    }
    Some(work)
}

fn number(value: &str) -> Result<u64, String> {
    parse_canonical_u64_decimal(value, "wire integer")
}

fn run() -> Result<(), String> {
    let epoch = generate_authority_epoch();
    let started = Instant::now();
    let mut registry =
        ResourceAuthority::new(epoch, Limits::default()).map_err(|e| format!("{e:?}"))?;
    // Deterministic, already-serialized bytes; the same backing serves A and B.
    let bytes: Arc<[u8]> = (0..(2 * 1024 * 1024))
        .map(|i| ((i * 31 + (i >> 8)) & 255) as u8)
        .collect::<Vec<_>>()
        .into();
    registry
        .publish("fixture", "opaque.fixture", 1, 1, bytes)
        .map_err(|e| format!("{e:?}"))?;
    let registry = Arc::new(Mutex::new(registry));
    let (control_tx, control_rx) = mpsc::sync_channel::<Value>(32);
    let (bulk_tx, bulk_rx) = mpsc::sync_channel::<Work>(8);
    std::thread::spawn(move || {
        let mut stdout = io::stdout().lock();
        for value in control_rx {
            if serde_json::to_writer(&mut stdout, &value).is_err()
                || stdout.write_all(b"\n").is_err()
                || stdout.flush().is_err()
            {
                std::process::exit(2);
            }
        }
    });
    let writer_registry = Arc::clone(&registry);
    std::thread::spawn(move || {
        let mut stderr = io::stderr().lock();
        let mut queue = VecDeque::new();
        let mut streak = 0;
        loop {
            if queue.is_empty() {
                match bulk_rx.recv() {
                    Ok(work) => queue.push_back(work),
                    Err(_) => break,
                }
            }
            while let Ok(work) = bulk_rx.try_recv() {
                queue.push_back(work);
            }
            // Registry admission bounds total writer+queued transfers to eight.
            let Some(work) = next_work(&mut queue, &mut streak) else {
                continue;
            };
            let transfer = work.transfer;
            if wire::write_transfer(&mut stderr, &transfer).is_err() {
                std::process::exit(3);
            }
            // Completion consumes the writer's backing owner before retiring its reservation.
            writer_registry.lock().unwrap().written(transfer);
        }
    });
    let send = |value| {
        control_tx
            .try_send(value)
            .map_err(|_| "control output capacity exhausted".to_string())
    };
    send(
        json!({ "kind": "authorityReady", "authorityEpoch": epoch.to_string(), "protocolVersion": 1, "nativeUs": started.elapsed().as_micros().to_string() }),
    )?;
    let mut input = BufReader::new(io::stdin().lock());
    let mut negotiated = false;
    loop {
        let mut line = Vec::new();
        let size = input
            .by_ref()
            .take(4097)
            .read_until(b'\n', &mut line)
            .map_err(|e| e.to_string())?;
        if size == 0 {
            return Ok(());
        }
        if size > 4096 || line.last() != Some(&b'\n') {
            return Err("control length/truncated EOF".into());
        }
        let request: Request = serde_json::from_slice(&line).map_err(|e| e.to_string())?;
        if request.kind != "control.request"
            || request.envelope_version != 1
            || request.request_key.is_empty()
            || request.request_key.len() > 64
        {
            return Err("invalid control envelope".into());
        }
        let received_us = started.elapsed().as_micros();
        let p = request.payload;
        let result: Result<Value, Value> = (|| {
            if request.operation_key == "resource.negotiate" {
                if negotiated || p.protocol_version != 1 {
                    return Err(
                        json!({"kind":"resourceContractViolation","detail":"unsupported/repeated negotiation"}),
                    );
                }
                negotiated = true;
                return Ok(json!({"protocolVersion":1,"ownership":"owned","canMapWindows":false}));
            }
            if !negotiated {
                return Err(json!({"kind":"resourceContractViolation","detail":"negotiate first"}));
            }
            if request.operation_key == "fixture.control" {
                return Ok(
                    json!({"receivedUs":received_us.to_string(),"appliedUs":started.elapsed().as_micros().to_string()}),
                );
            }
            let mut registry = registry
                .lock()
                .map_err(|_| json!({"kind":"authorityUnavailable"}))?;
            let parse = |s: &str| {
                number(s).map_err(|e| json!({"kind":"resourceContractViolation","detail":e}))
            };
            let failure = |e| match e {
                resource_runtime::Failure::ResourceUnavailable => {
                    json!({"kind":"resourceUnavailable","resourceKind":"opaque.fixture","resourceKey":"fixture"})
                }
                resource_runtime::Failure::HandleInvalid { reason } => {
                    json!({"kind":"handleInvalid","handleId":p.handle_id,"reason":reason})
                }
                resource_runtime::Failure::RangeInvalid => {
                    json!({"kind":"rangeInvalid","offsetBytes":p.offset_bytes,"lengthBytes":p.length_bytes})
                }
                resource_runtime::Failure::ChunkTooLarge => {
                    json!({"kind":"chunkTooLarge","requestedBytes":p.length_bytes,"maxChunkBytes":Limits::default().chunk_bytes})
                }
                resource_runtime::Failure::SessionMismatch => {
                    json!({"kind":"sessionMismatch","expectedAuthorityEpoch":epoch.to_string(),"providedAuthorityEpoch":p.authority_epoch})
                }
                other => serde_json::to_value(other).unwrap(),
            };
            match request.operation_key.as_str() {
                "resource.connect" => {
                    registry.connect(parse(&p.client)?).map_err(failure)?;
                    Ok(json!({}))
                }
                "resource.disconnect" => {
                    registry.disconnect(parse(&p.client)?);
                    Ok(json!({}))
                }
                "resource.open" => {
                    // The adapter grants only this known fixture. No native filesystem selector.
                    if p.resource_key != "fixture" {
                        return Err(json!({"kind":"resourceUnavailable"}));
                    }
                    registry
                        .open(parse(&p.client)?, &p.resource_key)
                        .map(|v| serde_json::to_value(v).unwrap())
                        .map_err(failure)
                }
                "resource.readChunk" => {
                    if p.priority != "visible" && p.priority != "background" {
                        return Err(
                            json!({"kind":"resourceContractViolation","detail":"invalid priority"}),
                        );
                    }
                    let transfer = registry
                        .read(
                            parse(&p.client)?,
                            parse(&p.authority_epoch)?,
                            parse(&p.handle_id)?,
                            parse(&p.offset_bytes)?,
                            p.length_bytes,
                            parse(&p.transfer_id)?,
                        )
                        .map_err(failure)?;
                    // No blocking write or wait under the registry lock. Admission is bounded.
                    if let Err(
                        mpsc::TrySendError::Full(work) | mpsc::TrySendError::Disconnected(work),
                    ) = bulk_tx.try_send(Work {
                        transfer,
                        visible: p.priority == "visible",
                    }) {
                        registry.reject_unsubmitted(work.transfer);
                        return Err(json!({"kind":"resourceBackpressure","scope":"authority"}));
                    }
                    Ok(json!({"accepted":true}))
                }
                "resource.receipt" => registry
                    .receipt(parse(&p.authority_epoch)?, parse(&p.transfer_id)?)
                    .map(|settled| json!({"settled":settled}))
                    .map_err(failure),
                "resource.closeHandle" => registry
                    .close(
                        parse(&p.client)?,
                        parse(&p.authority_epoch)?,
                        parse(&p.handle_id)?,
                    )
                    .map(|()| json!({}))
                    .map_err(failure),
                "fixture.revoke" => {
                    registry.revoke("fixture");
                    send(json!({"kind":"resourceInvalidated","authorityEpoch":epoch.to_string(),"resourceKey":"fixture","resourceVersion":"1","reason":"revoked"})).map_err(|e| json!({"kind":"resourceContractViolation","detail":e}))?;
                    Ok(json!({}))
                }
                "resource.metrics" => Ok(serde_json::to_value(registry.metrics()).unwrap()),
                _ => Err(json!({"kind":"resourceContractViolation","detail":"unknown operation"})),
            }
        })();
        let response = match result {
            Ok(payload) => {
                json!({"kind":"control.response","envelopeVersion":1,"requestKey":request.request_key,"ok":true,"payload":payload})
            }
            Err(failure) => {
                json!({"kind":"control.response","envelopeVersion":1,"requestKey":request.request_key,"ok":false,"failure":{"code":"control.rejected","message":"Resource request rejected","details":failure}})
            }
        };
        send(response)?;
    }
}

fn main() {
    // stderr is an exclusive binary pipe. Panics must not inject diagnostic text.
    std::panic::set_hook(Box::new(|_| {}));
    if run().is_err() {
        std::process::exit(1);
    }
}
