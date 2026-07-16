use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hash, Hasher};
use std::num::NonZeroU64;
use std::process;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn parse_canonical_u64_decimal(value: &str, label: &str) -> Result<u64, String> {
    if value.is_empty() {
        return Err(format!("{label} must be canonical unsigned decimal text"));
    }
    if value.len() > 1 && value.starts_with('0') {
        return Err(format!("{label} must not contain leading zeroes"));
    }
    if !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("{label} must contain decimal digits only"));
    }
    value
        .parse::<u64>()
        .map_err(|_| format!("{label} must fit in u64"))
}

pub fn parse_nonzero_authority_epoch(value: &str, label: &str) -> Result<u64, String> {
    let epoch = parse_canonical_u64_decimal(value, label)?;
    NonZeroU64::new(epoch)
        .map(NonZeroU64::get)
        .ok_or_else(|| format!("{label} must be nonzero"))
}

pub fn canonical_authority_epoch(epoch: u64) -> String {
    epoch.to_string()
}

pub fn generate_authority_epoch() -> u64 {
    let mut hasher = RandomState::new().build_hasher();
    process::id().hash(&mut hasher);
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
        .hash(&mut hasher);
    let stack_address = &hasher as *const _ as usize;
    stack_address.hash(&mut hasher);
    NonZeroU64::new(hasher.finish()).map_or(1, NonZeroU64::get)
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_authority_epoch, generate_authority_epoch, parse_canonical_u64_decimal,
        parse_nonzero_authority_epoch,
    };

    #[test]
    fn injected_epoch_requires_nonzero_canonical_decimal() {
        assert_eq!(parse_nonzero_authority_epoch("42", "epoch").unwrap(), 42);
        assert_eq!(canonical_authority_epoch(u64::MAX), u64::MAX.to_string());

        for invalid in ["", "0", "00", "01", "+1", "-1", "1.0", " 1"] {
            assert!(parse_nonzero_authority_epoch(invalid, "epoch").is_err());
        }
    }

    #[test]
    fn wire_epoch_parser_accepts_canonical_zero_but_not_aliases() {
        assert_eq!(parse_canonical_u64_decimal("0", "epoch").unwrap(), 0);
        assert!(parse_canonical_u64_decimal("000", "epoch").is_err());
    }

    #[test]
    fn generated_epoch_is_nonzero() {
        assert_ne!(generate_authority_epoch(), 0);
    }
}
