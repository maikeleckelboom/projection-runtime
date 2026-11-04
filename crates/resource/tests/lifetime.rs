use resource_runtime::{wire, Failure, Limits, ResourceAuthority};
use std::io::{self, Write};
use std::sync::Arc;

fn authority() -> ResourceAuthority {
    let mut a = ResourceAuthority::new(7, Limits::default()).unwrap();
    a.publish("page", "opaque", 2, 1, Arc::from(vec![9_u8; 512 * 1024]))
        .unwrap();
    a.connect(1).unwrap();
    a.connect(2).unwrap();
    a
}
fn handle(a: &mut ResourceAuthority, client: u64) -> u64 {
    a.open(client, "page").unwrap().handle_id.parse().unwrap()
}

#[test]
fn close_and_cancel_a_preserve_b_and_owned_bytes() {
    let mut a = authority();
    let ha = handle(&mut a, 1);
    let hb = handle(&mut a, 2);
    let ta = a.read(1, 7, ha, 0, 32, 1).unwrap();
    let tb = a.read(2, 7, hb, 0, 32, 2).unwrap();
    let owned = ta.bytes().to_vec();
    a.close(1, 7, ha).unwrap();
    a.disconnect(1);
    assert_eq!(tb.bytes(), owned);
    assert_eq!(a.metrics().resident_bytes, 512 * 1024);
    assert_eq!(a.metrics().in_flight_bytes, 64);
    a.written(ta);
    assert!(a.receipt(7, 1).unwrap());
    assert_eq!(a.metrics().in_flight_bytes, 32);
    assert_eq!(a.metrics().clients, 1);
    assert_eq!(owned, vec![9; 32]);
    assert!(!a.receipt(7, 2).unwrap());
    assert!(a.written(tb));
    assert_eq!(a.metrics().in_flight_bytes, 0);
}

#[test]
fn receipt_writer_close_revoke_races_never_recycle_pinned_backing() {
    for receipt_first in [true, false] {
        let mut a = authority();
        let h = handle(&mut a, 1);
        let t = a.read(1, 7, h, 0, 1024, 1).unwrap();
        assert_eq!(a.revoke("page").len(), 1);
        assert!(a.open(2, "page").is_err());
        assert_eq!(a.metrics().resident_bytes, 512 * 1024);
        if receipt_first {
            assert!(!a.receipt(7, 1).unwrap());
        }
        assert_eq!(t.bytes(), vec![9; 1024]);
        assert_eq!(a.written(t), receipt_first);
        if !receipt_first {
            assert!(a.receipt(7, 1).unwrap());
        }
        assert!(!a.receipt(7, 1).unwrap());
        assert_eq!(a.metrics().settled, 1);
        assert_eq!(a.metrics().resident_bytes, 0);
    }
}

#[test]
fn quotas_and_cross_client_epoch_and_ranges_fail_closed() {
    let mut a = authority();
    let h = handle(&mut a, 1);
    assert!(matches!(
        a.read(2, 7, h, 0, 1, 1),
        Err(Failure::HandleInvalid { .. })
    ));
    assert!(matches!(
        a.read(1, 8, h, 0, 1, 2),
        Err(Failure::SessionMismatch)
    ));
    for (id, offset, len) in [(3, u64::MAX, 2), (4, 0, 0), (5, 512 * 1024, 1)] {
        assert!(matches!(
            a.read(1, 7, h, offset, len, id),
            Err(Failure::RangeInvalid)
        ));
    }
    let mut transfers = Vec::new();
    for id in 6..10 {
        transfers.push(a.read(1, 7, h, 0, 256 * 1024, id).unwrap());
    }
    assert_eq!(a.metrics().in_flight_bytes, 1024 * 1024);
    assert!(matches!(
        a.read(1, 7, h, 0, 1, 10),
        Err(Failure::ResourceBackpressure { .. })
    ));
    a.disconnect(1);
    assert_eq!(a.metrics().in_flight_bytes, 1024 * 1024);
    for t in transfers {
        let id = t.id();
        a.written(t);
        a.receipt(7, id).unwrap();
    }
    assert_eq!(a.metrics().in_flight_bytes, 0);
}

#[test]
fn finite_handles_and_resource_admission() {
    let mut a = authority();
    for _ in 0..16 {
        a.open(1, "page").unwrap();
    }
    assert!(matches!(
        a.open(1, "page"),
        Err(Failure::ResourceBackpressure { .. })
    ));
    assert!(a
        .publish("huge", "opaque", 1, 1, Arc::from(vec![0; 8 * 1024 * 1024]))
        .is_err());
    assert!(a
        .publish("page", "opaque", 3, 1, Arc::from(vec![0; 1]))
        .is_err());
    a.disconnect(1);
    assert_eq!(a.metrics().handles, 0);
}

#[test]
fn completion_from_another_registry_cannot_return_capacity() {
    let mut a = authority();
    let mut b = authority();
    let ha = handle(&mut a, 1);
    let hb = handle(&mut b, 1);
    let ta = a.read(1, 7, ha, 0, 32, 1).unwrap();
    let tb = b.read(1, 7, hb, 0, 32, 1).unwrap();
    b.receipt(7, 1).unwrap();
    b.revoke("page");
    assert!(!b.written(ta));
    assert_eq!(b.metrics().in_flight_bytes, 32);
    assert_eq!(b.metrics().resident_bytes, 512 * 1024);
    assert!(b.written(tb));
    assert_eq!(b.metrics().resident_bytes, 0);
}

struct ShortWriter {
    bytes: Vec<u8>,
    fail_after: Option<usize>,
}
impl Write for ShortWriter {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        if self.fail_after.is_some_and(|n| self.bytes.len() >= n) {
            return Err(io::ErrorKind::BrokenPipe.into());
        }
        let count = b.len().min(3);
        self.bytes.extend_from_slice(&b[..count]);
        Ok(count)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
#[test]
fn frame_golden_partial_writes_and_failed_writes() {
    let mut a = authority();
    let h = handle(&mut a, 1);
    let t = a.read(1, 7, h, 512 * 1024 - 4, 4, 1).unwrap();
    let mut w = ShortWriter {
        bytes: vec![],
        fail_after: None,
    };
    wire::write_transfer(&mut w, &t).unwrap();
    assert_eq!(&w.bytes[..16], b"EXRB\x01\0\x01\0\x04\0\0\0\x01\0\0\0");
    assert_eq!(&w.bytes[16..24], &1_u64.to_le_bytes());
    assert_eq!(&w.bytes[24..32], &7_u64.to_le_bytes());
    assert_eq!(&w.bytes[40..48], &2_u64.to_le_bytes());
    assert_eq!(&w.bytes[48..], &[9; 4]);
    let mut failed = ShortWriter {
        bytes: vec![],
        fail_after: Some(12),
    };
    assert!(wire::write_transfer(&mut failed, &t).is_err());
    assert_eq!(a.metrics().in_flight_bytes, 4); // only teardown can reconcile a failed physical stream
}
