//! Opaque immutable resources. No filesystem, Electron, graphics or audio ownership.
use serde::Serialize;
use std::collections::HashMap;
use std::sync::Arc;

pub mod wire;

#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub resident_bytes: usize,
    pub chunk_bytes: usize,
    pub client_bytes: usize,
    pub total_bytes: usize,
    pub client_transfers: usize,
    pub total_transfers: usize,
    pub client_handles: usize,
    pub total_handles: usize,
    pub clients: usize,
    pub resources: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            resident_bytes: 8 * 1024 * 1024,
            chunk_bytes: 256 * 1024,
            client_bytes: 1024 * 1024,
            total_bytes: 2 * 1024 * 1024,
            client_transfers: 4,
            total_transfers: 8,
            client_handles: 16,
            total_handles: 32,
            clients: 2,
            resources: 32,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Failure {
    ResourceContractViolation { detail: &'static str },
    ResourceBackpressure { scope: &'static str },
    ResourceUnavailable,
    HandleInvalid { reason: &'static str },
    RangeInvalid,
    ChunkTooLarge,
    SessionMismatch,
}
type Result<T> = std::result::Result<T, Failure>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Descriptor {
    pub handle_id: String,
    pub authority_epoch: String,
    pub resource_kind: String,
    pub resource_key: String,
    pub resource_version: String,
    pub byte_length: String,
    pub payload_version: u32,
    pub max_chunk_bytes: usize,
}

struct Backing {
    bytes: Arc<[u8]>,
    kind: String,
    version: u64,
    payload_version: u32,
    available: bool,
    transfers: usize,
}
struct Handle {
    client: u64,
    key: String,
}
struct Reservation {
    client: u64,
    key: String,
    bytes: usize,
    written: bool,
    received: bool,
}

/// Pins the immutable backing until both the writer and receiver have completed.
pub struct Transfer {
    id: u64,
    epoch: u64,
    version: u64,
    offset: u64,
    length: usize,
    eof: bool,
    backing: Arc<[u8]>,
    owner: Arc<()>,
}
impl Transfer {
    pub fn id(&self) -> u64 {
        self.id
    }
    pub fn bytes(&self) -> &[u8] {
        &self.backing[self.offset as usize..self.offset as usize + self.length]
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub resident_bytes: usize,
    pub in_flight_bytes: usize,
    pub transfers: usize,
    pub handles: usize,
    pub clients: usize,
    pub settled: u64,
    pub duplicate_receipts: u64,
}

pub struct ResourceAuthority {
    identity: Arc<()>,
    epoch: u64,
    limits: Limits,
    clients: HashMap<u64, bool>,
    resources: HashMap<String, Backing>,
    handles: HashMap<u64, Handle>,
    transfers: HashMap<u64, Reservation>,
    next_handle: u64,
    last_transfer: u64,
    settled: u64,
    duplicate_receipts: u64,
}

impl ResourceAuthority {
    pub fn new(epoch: u64, limits: Limits) -> Result<Self> {
        if epoch == 0
            || limits.chunk_bytes == 0
            || limits.chunk_bytes > wire::MAX_CHUNK_BYTES
            || limits.client_bytes < limits.chunk_bytes
            || limits.total_bytes < limits.client_bytes
            || limits.client_transfers == 0
            || limits.total_transfers < limits.client_transfers
            || limits.client_handles == 0
            || limits.total_handles < limits.client_handles
            || limits.clients == 0
            || limits.resources == 0
        {
            return Err(Failure::ResourceContractViolation {
                detail: "invalid limits/epoch",
            });
        }
        Ok(Self {
            identity: Arc::new(()),
            epoch,
            limits,
            clients: HashMap::new(),
            resources: HashMap::new(),
            handles: HashMap::new(),
            transfers: HashMap::new(),
            next_handle: 1,
            last_transfer: 0,
            settled: 0,
            duplicate_receipts: 0,
        })
    }

    /// Called only by an authorized product adapter. Ownership of this immutable
    /// allocation moves into the registry; external retained aliases are caller-owned.
    pub fn publish(
        &mut self,
        key: &str,
        kind: &str,
        version: u64,
        payload_version: u32,
        bytes: Arc<[u8]>,
    ) -> Result<()> {
        if key.is_empty()
            || key.len() > 128
            || kind.is_empty()
            || kind.len() > 128
            || version == 0
            || payload_version == 0
        {
            return Err(Failure::ResourceContractViolation {
                detail: "invalid identity",
            });
        }
        if self.resources.contains_key(key) {
            return Err(Failure::ResourceContractViolation {
                detail: "revoke and retire old version before republishing key",
            });
        }
        if self.resources.len() >= self.limits.resources
            || bytes.len()
                > self
                    .limits
                    .resident_bytes
                    .saturating_sub(self.metrics().resident_bytes)
        {
            return Err(Failure::ResourceBackpressure { scope: "authority" });
        }
        self.resources.insert(
            key.into(),
            Backing {
                bytes,
                kind: kind.into(),
                version,
                payload_version,
                available: true,
                transfers: 0,
            },
        );
        Ok(())
    }

    pub fn connect(&mut self, client: u64) -> Result<()> {
        if client == 0 || self.clients.contains_key(&client) {
            return Err(Failure::ResourceContractViolation {
                detail: "connection identity reused",
            });
        }
        if self.clients.len() >= self.limits.clients {
            return Err(Failure::ResourceBackpressure { scope: "authority" });
        }
        self.clients.insert(client, true);
        Ok(())
    }

    pub fn open(&mut self, client: u64, key: &str) -> Result<Descriptor> {
        self.require_client(client)?;
        if self.handles.len() >= self.limits.total_handles
            || self.handles.values().filter(|h| h.client == client).count()
                >= self.limits.client_handles
        {
            return Err(Failure::ResourceBackpressure { scope: "consumer" });
        }
        let backing = self
            .resources
            .get(key)
            .filter(|b| b.available)
            .ok_or(Failure::ResourceUnavailable)?;
        let id = self.next_handle;
        self.next_handle = id
            .checked_add(1)
            .ok_or(Failure::ResourceContractViolation {
                detail: "handle identity exhausted",
            })?;
        let descriptor = Descriptor {
            handle_id: id.to_string(),
            authority_epoch: self.epoch.to_string(),
            resource_kind: backing.kind.clone(),
            resource_key: key.into(),
            resource_version: backing.version.to_string(),
            byte_length: backing.bytes.len().to_string(),
            payload_version: backing.payload_version,
            max_chunk_bytes: self.limits.chunk_bytes,
        };
        self.handles.insert(
            id,
            Handle {
                client,
                key: key.into(),
            },
        );
        Ok(descriptor)
    }

    pub fn read(
        &mut self,
        client: u64,
        epoch: u64,
        handle: u64,
        offset: u64,
        length: usize,
        id: u64,
    ) -> Result<Transfer> {
        self.require_epoch(epoch)?;
        self.require_client(client)?;
        if id <= self.last_transfer {
            return Err(Failure::ResourceContractViolation {
                detail: "transfer identity reused",
            });
        }
        self.last_transfer = id;
        let handle = self
            .handles
            .get(&handle)
            .filter(|h| h.client == client)
            .ok_or(Failure::HandleInvalid { reason: "closed" })?;
        if length == 0 {
            return Err(Failure::RangeInvalid);
        }
        if length > self.limits.chunk_bytes {
            return Err(Failure::ChunkTooLarge);
        }
        let backing = self
            .resources
            .get(&handle.key)
            .filter(|b| b.available)
            .ok_or(Failure::ResourceUnavailable)?;
        let end = offset
            .checked_add(length as u64)
            .filter(|end| *end <= backing.bytes.len() as u64)
            .ok_or(Failure::RangeInvalid)?;
        let client_count = self
            .transfers
            .values()
            .filter(|t| t.client == client)
            .count();
        let client_bytes: usize = self
            .transfers
            .values()
            .filter(|t| t.client == client)
            .map(|t| t.bytes)
            .sum();
        if self.transfers.len() >= self.limits.total_transfers
            || client_count >= self.limits.client_transfers
            || length > self.limits.client_bytes.saturating_sub(client_bytes)
            || length
                > self
                    .limits
                    .total_bytes
                    .saturating_sub(self.metrics().in_flight_bytes)
        {
            return Err(Failure::ResourceBackpressure { scope: "consumer" });
        }
        let key = handle.key.clone();
        let transfer = Transfer {
            id,
            epoch,
            version: backing.version,
            offset,
            length,
            eof: end == backing.bytes.len() as u64,
            backing: Arc::clone(&backing.bytes),
            owner: Arc::clone(&self.identity),
        };
        self.transfers.insert(
            id,
            Reservation {
                client,
                key: key.clone(),
                bytes: length,
                written: false,
                received: false,
            },
        );
        self.resources.get_mut(&key).unwrap().transfers += 1;
        Ok(transfer)
    }

    pub fn close(&mut self, client: u64, epoch: u64, handle: u64) -> Result<()> {
        self.require_epoch(epoch)?;
        match self.handles.get(&handle) {
            Some(h) if h.client == client => {
                self.handles.remove(&handle);
                Ok(())
            }
            _ => Err(Failure::HandleInvalid { reason: "closed" }),
        }
    }

    /// Acknowledgement never releases a still-writing backing allocation.
    pub fn receipt(&mut self, epoch: u64, id: u64) -> Result<bool> {
        self.require_epoch(epoch)?;
        match self.transfers.get_mut(&id) {
            Some(t) if !t.received => {
                t.received = true;
                Ok(self.retire(id))
            }
            _ => {
                self.duplicate_receipts += 1;
                Ok(false)
            }
        }
    }
    pub fn written(&mut self, transfer: Transfer) -> bool {
        if !Arc::ptr_eq(&self.identity, &transfer.owner) {
            return false;
        }
        let id = transfer.id;
        drop(transfer);
        if let Some(t) = self.transfers.get_mut(&id) {
            t.written = true;
        }
        self.retire(id)
    }
    /// Only before submission to a physical writer.
    pub fn reject_unsubmitted(&mut self, transfer: Transfer) -> bool {
        if !Arc::ptr_eq(&self.identity, &transfer.owner) {
            return false;
        }
        let id = transfer.id;
        drop(transfer);
        if let Some(t) = self.transfers.get_mut(&id) {
            t.received = true;
            t.written = true;
        }
        self.retire(id)
    }
    pub fn disconnect(&mut self, client: u64) {
        if let Some(live) = self.clients.get_mut(&client) {
            *live = false;
        }
        self.handles.retain(|_, h| h.client != client);
        // Outstanding transfers still need writer completion and broker discard receipt.
        self.prune_client(client);
    }
    pub fn revoke(&mut self, key: &str) -> Vec<(u64, String)> {
        let invalidated: Vec<_> = self
            .handles
            .iter()
            .filter(|(_, h)| h.key == key)
            .map(|(id, h)| (h.client, id.to_string()))
            .collect();
        self.handles.retain(|_, h| h.key != key);
        if let Some(backing) = self.resources.get_mut(key) {
            backing.available = false;
        }
        self.prune_backing(key);
        invalidated
    }
    pub fn metrics(&self) -> Metrics {
        Metrics {
            resident_bytes: self.resources.values().map(|b| b.bytes.len()).sum(),
            in_flight_bytes: self.transfers.values().map(|t| t.bytes).sum(),
            transfers: self.transfers.len(),
            handles: self.handles.len(),
            clients: self.clients.len(),
            settled: self.settled,
            duplicate_receipts: self.duplicate_receipts,
        }
    }
    fn require_client(&self, client: u64) -> Result<()> {
        if self.clients.get(&client) == Some(&true) {
            Ok(())
        } else {
            Err(Failure::HandleInvalid { reason: "revoked" })
        }
    }
    fn require_epoch(&self, epoch: u64) -> Result<()> {
        if epoch == self.epoch {
            Ok(())
        } else {
            Err(Failure::SessionMismatch)
        }
    }
    fn retire(&mut self, id: u64) -> bool {
        if !self
            .transfers
            .get(&id)
            .is_some_and(|t| t.written && t.received)
        {
            return false;
        }
        let t = self.transfers.remove(&id).unwrap();
        self.resources.get_mut(&t.key).unwrap().transfers -= 1;
        self.settled += 1;
        self.prune_backing(&t.key);
        self.prune_client(t.client);
        true
    }
    fn prune_backing(&mut self, key: &str) {
        if self
            .resources
            .get(key)
            .is_some_and(|b| !b.available && b.transfers == 0)
        {
            self.resources.remove(key);
        }
    }
    fn prune_client(&mut self, client: u64) {
        if self.clients.get(&client) == Some(&false)
            && !self.transfers.values().any(|t| t.client == client)
        {
            self.clients.remove(&client);
        }
    }
}
