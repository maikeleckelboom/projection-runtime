//! Manifest-derived Warm Codec v1 snapshot payload encoding and decoding.

use crate::hex;
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Number, Value};
use std::cmp::Ordering;
use std::collections::HashSet;

pub const MAX_WARM_PAYLOAD_BYTE_LENGTH: usize = 1024 * 1024;
const MAX_MANIFEST_SHAPE_DEPTH: usize = 64;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarmManifest {
    pub codec: Option<String>,
    pub contract_key: Option<String>,
    pub fields: Vec<WarmField>,
    pub semantic_version: Option<String>,
    pub warm_codec_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WarmField {
    pub dot_path: String,
    pub shape: WarmShape,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind")]
pub enum WarmShape {
    FixedScalar {
        #[serde(rename = "type")]
        scalar_type: ScalarType,
        #[serde(
            default,
            rename = "nanSentinel",
            deserialize_with = "deserialize_present_bool"
        )]
        nan_sentinel: Option<bool>,
    },
    FixedEnum {
        storage: EnumStorage,
        variants: Vec<String>,
    },
    FixedVector {
        #[serde(rename = "elementType")]
        element_type: ScalarType,
        length: u32,
    },
    BoundedArray {
        #[serde(rename = "elementType")]
        element_type: ScalarType,
        #[serde(rename = "maxLength")]
        max_length: u32,
    },
    BoundedMap {
        #[serde(rename = "keyByteLength")]
        key_byte_length: u16,
        #[serde(
            default,
            rename = "keyEncoding",
            deserialize_with = "deserialize_present_string"
        )]
        key_encoding: Option<String>,
        #[serde(rename = "maxEntries")]
        max_entries: u32,
        #[serde(rename = "valueShape")]
        value_shape: Box<WarmShape>,
    },
    VariableMap {
        #[serde(rename = "valueShape")]
        value_shape: Box<WarmShape>,
    },
    FixedStringEncoded {
        #[serde(rename = "byteLength")]
        byte_length: u16,
        encoding: String,
    },
    VariableString,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScalarType {
    Bool,
    U8,
    U16,
    U32,
    U64,
    I8,
    I16,
    I32,
    I64,
    F32,
    F64,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnumStorage {
    U8,
    U16,
    U32,
}

fn deserialize_present_bool<'de, D>(deserializer: D) -> Result<Option<bool>, D::Error>
where
    D: Deserializer<'de>,
{
    bool::deserialize(deserializer).map(Some)
}

fn deserialize_present_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    String::deserialize(deserializer).map(Some)
}

pub fn encode_warm_snapshot_payload(
    manifest: &WarmManifest,
    snapshot: &Value,
) -> Result<Vec<u8>, String> {
    let fields = normalized_fields(manifest)?;
    let snapshot = snapshot
        .as_object()
        .ok_or_else(|| "snapshot must be an object".to_string())?;
    let mut writer = PayloadWriter::new();

    for key in snapshot.keys() {
        if !fields.iter().any(|field| field.dot_path == *key) {
            return Err(format!("unknown warm snapshot field {key}"));
        }
    }

    for field in fields {
        let value = snapshot
            .get(&field.dot_path)
            .ok_or_else(|| format!("missing value for warm field {}", field.dot_path))?;
        write_value(
            &mut writer,
            &field.shape,
            value,
            &format!("snapshot.{}", field.dot_path),
        )?;
    }

    writer.into_bytes()
}

pub fn decode_warm_snapshot_payload(
    manifest: &WarmManifest,
    bytes: &[u8],
) -> Result<Value, String> {
    if bytes.len() > MAX_WARM_PAYLOAD_BYTE_LENGTH {
        return Err(format!(
            "warm snapshot payload byte length {} exceeds profile maximum {MAX_WARM_PAYLOAD_BYTE_LENGTH}",
            bytes.len()
        ));
    }
    let fields = normalized_fields(manifest)?;
    let mut reader = PayloadReader::new(bytes);
    let mut snapshot = Map::new();

    for field in fields {
        let value = read_value(
            &mut reader,
            &field.shape,
            &format!("payload.{}", field.dot_path),
        )?;
        snapshot.insert(field.dot_path.clone(), value);
    }

    if reader.offset != bytes.len() {
        return Err(format!(
            "warm snapshot payload has {} trailing byte(s)",
            bytes.len() - reader.offset
        ));
    }

    Ok(Value::Object(snapshot))
}

pub fn json_equivalent(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(left), Value::Bool(right)) => left == right,
        (Value::String(left), Value::String(right)) => left == right,
        (Value::Number(left), Value::Number(right)) => numbers_equivalent(left, right),
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right.iter())
                    .all(|(left, right)| json_equivalent(left, right))
        }
        (Value::Object(left), Value::Object(right)) => {
            left.len() == right.len()
                && left.iter().all(|(key, left_value)| {
                    right
                        .get(key)
                        .is_some_and(|right_value| json_equivalent(left_value, right_value))
                })
        }
        _ => false,
    }
}

fn normalized_fields(manifest: &WarmManifest) -> Result<Vec<&WarmField>, String> {
    if let Some(codec) = &manifest.codec {
        if codec != "framed-snapshot" {
            return Err(format!(
                "warm manifest codec must be framed-snapshot, got {codec}"
            ));
        }
    }

    if manifest.fields.len() > MAX_WARM_PAYLOAD_BYTE_LENGTH {
        return Err(format!(
            "warm manifest field count {} exceeds profile maximum {MAX_WARM_PAYLOAD_BYTE_LENGTH}",
            manifest.fields.len()
        ));
    }

    let mut minimum_payload_byte_length = 0_usize;
    for (index, field) in manifest.fields.iter().enumerate() {
        let path = format!("manifest.fields.{index}");
        if field.dot_path.is_empty() {
            return Err(format!("{path}.dotPath must be non-empty UTF-8 text"));
        }
        let layout = validate_shape(&field.shape, &format!("{path}.shape"), 0, false)?;
        minimum_payload_byte_length = minimum_payload_byte_length
            .checked_add(layout.minimum_byte_length)
            .ok_or_else(|| {
                "warm manifest minimum payload byte length overflowed usize".to_string()
            })?;
        if minimum_payload_byte_length > MAX_WARM_PAYLOAD_BYTE_LENGTH {
            return Err(format!(
                "warm manifest minimum payload byte length {minimum_payload_byte_length} exceeds profile maximum {MAX_WARM_PAYLOAD_BYTE_LENGTH}"
            ));
        }
    }

    let mut fields = Vec::new();
    fields
        .try_reserve_exact(manifest.fields.len())
        .map_err(|_| "warm manifest field index could not be reserved".to_string())?;
    fields.extend(manifest.fields.iter());
    fields
        .sort_by(|left, right| compare_bytes(left.dot_path.as_bytes(), right.dot_path.as_bytes()));
    for pair in fields.windows(2) {
        if pair[0].dot_path == pair[1].dot_path {
            return Err(format!(
                "duplicate manifest field dotPath {}",
                pair[1].dot_path
            ));
        }
    }
    Ok(fields)
}

#[derive(Debug, Clone, Copy)]
struct ShapeLayout {
    minimum_byte_length: usize,
    maximum_byte_length: Option<usize>,
}

impl ShapeLayout {
    fn fixed(byte_length: usize) -> Self {
        Self {
            minimum_byte_length: byte_length,
            maximum_byte_length: Some(byte_length),
        }
    }
}

fn validate_shape(
    shape: &WarmShape,
    path: &str,
    depth: usize,
    bounded_map_value_shape: bool,
) -> Result<ShapeLayout, String> {
    if depth >= MAX_MANIFEST_SHAPE_DEPTH {
        return Err(format!(
            "{path} exceeds maximum manifest shape depth {MAX_MANIFEST_SHAPE_DEPTH}"
        ));
    }

    let layout = match shape {
        WarmShape::FixedScalar {
            scalar_type,
            nan_sentinel,
        } => {
            match nan_sentinel {
                Some(false) => {
                    return Err(format!("{path}.nanSentinel must be true when present"));
                }
                Some(true) => {
                    return Err(format!(
                        "{path}.nanSentinel is unsupported by the Rust JSON value profile"
                    ));
                }
                None => {}
            }
            ShapeLayout::fixed(scalar_byte_length(*scalar_type))
        }
        WarmShape::FixedEnum { storage, variants } => {
            if variants.is_empty() {
                return Err(format!("{path}.variants must be a non-empty array"));
            }
            let maximum_variant_count = enum_storage_variant_capacity(*storage);
            if variants.len() as u128 > maximum_variant_count {
                return Err(format!(
                    "{path}.variants count {} exceeds declared {:?} storage capacity {maximum_variant_count}",
                    variants.len(),
                    storage
                ));
            }

            let mut seen = HashSet::new();
            seen.try_reserve(variants.len()).map_err(|_| {
                format!("{path}.variants validation capacity could not be reserved")
            })?;
            for (index, variant) in variants.iter().enumerate() {
                if variant.is_empty() {
                    return Err(format!(
                        "{path}.variants.{index} must be a non-empty string"
                    ));
                }
                if !seen.insert(variant.as_str()) {
                    return Err(format!(
                        "{path}.variants.{index} duplicates FixedEnum variant {variant:?}"
                    ));
                }
            }
            ShapeLayout::fixed(enum_storage_byte_length(*storage))
        }
        WarmShape::FixedVector {
            element_type,
            length,
        } => {
            if *length == 0 {
                return Err(format!("{path}.length must be a positive u32 value"));
            }
            let byte_length = checked_profile_product(
                *length,
                scalar_byte_length(*element_type),
                &format!("{path}.length"),
            )?;
            ShapeLayout::fixed(byte_length)
        }
        WarmShape::BoundedArray {
            element_type,
            max_length,
        } => {
            if *max_length == 0 {
                return Err(format!("{path}.maxLength must be a positive u32 value"));
            }
            let maximum_elements_byte_length = checked_profile_product(
                *max_length,
                scalar_byte_length(*element_type),
                &format!("{path}.maxLength"),
            )?;
            ShapeLayout {
                minimum_byte_length: 4,
                maximum_byte_length: Some(checked_profile_sum(
                    4,
                    maximum_elements_byte_length,
                    path,
                )?),
            }
        }
        WarmShape::BoundedMap {
            key_byte_length,
            key_encoding,
            max_entries,
            value_shape,
        } => {
            if bounded_map_value_shape {
                return Err(format!(
                    "{path} BoundedMap valueShape must be FixedScalar, FixedEnum, or FixedVector"
                ));
            }
            if *key_byte_length == 0 {
                return Err(format!("{path}.keyByteLength must be a positive u16 value"));
            }
            if key_encoding
                .as_deref()
                .is_some_and(|encoding| encoding != "fixed-ascii")
            {
                return Err(format!(
                    "{path}.keyEncoding must be fixed-ascii when present"
                ));
            }
            if *max_entries == 0 {
                return Err(format!("{path}.maxEntries must be a positive u32 value"));
            }
            if !matches!(
                value_shape.as_ref(),
                WarmShape::FixedScalar { .. }
                    | WarmShape::FixedEnum { .. }
                    | WarmShape::FixedVector { .. }
            ) {
                return Err(format!(
                    "{path}.valueShape must be FixedScalar, FixedEnum, or FixedVector"
                ));
            }
            let value_layout =
                validate_shape(value_shape, &format!("{path}.valueShape"), depth + 1, true)?;
            let value_byte_length = value_layout.maximum_byte_length.ok_or_else(|| {
                format!("{path}.valueShape must have a fixed encoded byte length")
            })?;
            let entry_byte_length = checked_profile_sum(
                *key_byte_length as usize,
                value_byte_length,
                &format!("{path}.valueShape"),
            )?;
            let maximum_entries_byte_length = checked_profile_product(
                *max_entries,
                entry_byte_length,
                &format!("{path}.maxEntries"),
            )?;
            ShapeLayout {
                minimum_byte_length: 4,
                maximum_byte_length: Some(checked_profile_sum(
                    4,
                    maximum_entries_byte_length,
                    path,
                )?),
            }
        }
        WarmShape::VariableMap { value_shape } => {
            let value_layout =
                validate_shape(value_shape, &format!("{path}.valueShape"), depth + 1, false)?;
            checked_profile_sum(4, value_layout.minimum_byte_length, path)?;
            ShapeLayout {
                minimum_byte_length: 4,
                maximum_byte_length: None,
            }
        }
        WarmShape::FixedStringEncoded {
            byte_length,
            encoding,
        } => {
            if *byte_length == 0 {
                return Err(format!("{path}.byteLength must be a positive u16 value"));
            }
            if encoding != "ascii" && encoding != "utf8" {
                return Err(format!("{path}.encoding is unsupported: {encoding}"));
            }
            ShapeLayout {
                minimum_byte_length: 2,
                maximum_byte_length: Some(2 + *byte_length as usize),
            }
        }
        WarmShape::VariableString => ShapeLayout {
            minimum_byte_length: 4,
            maximum_byte_length: None,
        },
    };

    if layout
        .maximum_byte_length
        .is_some_and(|maximum| maximum > MAX_WARM_PAYLOAD_BYTE_LENGTH)
    {
        return Err(format!(
            "{path} maximum encoded byte length {} exceeds profile maximum {MAX_WARM_PAYLOAD_BYTE_LENGTH}",
            layout.maximum_byte_length.unwrap()
        ));
    }

    Ok(layout)
}

fn checked_profile_product(
    count: u32,
    item_byte_length: usize,
    path: &str,
) -> Result<usize, String> {
    let byte_length = (count as usize)
        .checked_mul(item_byte_length)
        .ok_or_else(|| format!("{path} encoded byte length overflowed usize"))?;
    if byte_length > MAX_WARM_PAYLOAD_BYTE_LENGTH {
        return Err(format!(
            "{path} encoded byte length {byte_length} exceeds profile maximum {MAX_WARM_PAYLOAD_BYTE_LENGTH}"
        ));
    }
    Ok(byte_length)
}

fn checked_profile_sum(left: usize, right: usize, path: &str) -> Result<usize, String> {
    let byte_length = left
        .checked_add(right)
        .ok_or_else(|| format!("{path} encoded byte length overflowed usize"))?;
    if byte_length > MAX_WARM_PAYLOAD_BYTE_LENGTH {
        return Err(format!(
            "{path} encoded byte length {byte_length} exceeds profile maximum {MAX_WARM_PAYLOAD_BYTE_LENGTH}"
        ));
    }
    Ok(byte_length)
}

fn scalar_byte_length(scalar_type: ScalarType) -> usize {
    match scalar_type {
        ScalarType::Bool | ScalarType::U8 | ScalarType::I8 => 1,
        ScalarType::U16 | ScalarType::I16 => 2,
        ScalarType::U32 | ScalarType::I32 | ScalarType::F32 => 4,
        ScalarType::U64 | ScalarType::I64 | ScalarType::F64 => 8,
    }
}

fn enum_storage_byte_length(storage: EnumStorage) -> usize {
    match storage {
        EnumStorage::U8 => 1,
        EnumStorage::U16 => 2,
        EnumStorage::U32 => 4,
    }
}

fn enum_storage_variant_capacity(storage: EnumStorage) -> u128 {
    match storage {
        EnumStorage::U8 => u8::MAX as u128 + 1,
        EnumStorage::U16 => u16::MAX as u128 + 1,
        EnumStorage::U32 => u32::MAX as u128 + 1,
    }
}

fn write_value(
    writer: &mut PayloadWriter,
    shape: &WarmShape,
    value: &Value,
    path: &str,
) -> Result<(), String> {
    match shape {
        WarmShape::FixedScalar {
            scalar_type,
            nan_sentinel,
        } => write_scalar(
            writer,
            *scalar_type,
            nan_sentinel.unwrap_or(false),
            value,
            path,
        ),
        WarmShape::FixedEnum { storage, variants } => {
            let value = value
                .as_str()
                .ok_or_else(|| format!("{path} FixedEnum value must be a string variant"))?;
            let index = variants
                .iter()
                .position(|variant| variant == value)
                .ok_or_else(|| format!("{path} unknown FixedEnum variant {value:?}"))?;
            let discriminant = u32::try_from(index)
                .map_err(|_| format!("{path} FixedEnum discriminant must fit in u32"))?;
            write_unsigned_storage(writer, *storage, discriminant, path)?;
            Ok(())
        }
        WarmShape::FixedVector {
            element_type,
            length,
        } => {
            let values = value
                .as_array()
                .ok_or_else(|| format!("{path} FixedVector value must be an array"))?;
            if values.len() != *length as usize {
                return Err(format!(
                    "{path} FixedVector length must be exactly {length}"
                ));
            }
            for (index, value) in values.iter().enumerate() {
                write_scalar(
                    writer,
                    *element_type,
                    false,
                    value,
                    &format!("{path}.{index}"),
                )?;
            }
            Ok(())
        }
        WarmShape::BoundedArray {
            element_type,
            max_length,
        } => {
            let values = value
                .as_array()
                .ok_or_else(|| format!("{path} BoundedArray value must be an array"))?;
            if values.len() > *max_length as usize {
                return Err(format!(
                    "{path} BoundedArray length must be <= {max_length}"
                ));
            }
            require_profile_collection_capacity(
                values.len(),
                scalar_byte_length(*element_type),
                path,
            )?;
            writer.write_u32(
                u32::try_from(values.len())
                    .map_err(|_| format!("{path} BoundedArray length must fit in u32"))?,
            );
            for (index, value) in values.iter().enumerate() {
                write_scalar(
                    writer,
                    *element_type,
                    false,
                    value,
                    &format!("{path}.{index}"),
                )?;
            }
            Ok(())
        }
        WarmShape::BoundedMap {
            key_byte_length,
            key_encoding,
            max_entries,
            value_shape,
        } => {
            if key_encoding
                .as_deref()
                .is_some_and(|encoding| encoding != "fixed-ascii")
            {
                return Err(format!("{path} BoundedMap keyEncoding must be fixed-ascii"));
            }
            require_fixed_value_shape(value_shape, path)?;
            let map = value
                .as_object()
                .ok_or_else(|| format!("{path} BoundedMap value must be an object"))?;
            if map.len() > *max_entries as usize {
                return Err(format!(
                    "{path} BoundedMap entry count must be <= {max_entries}"
                ));
            }
            let value_byte_length = fixed_shape_byte_length(value_shape, path)?;
            let entry_byte_length = (*key_byte_length as usize)
                .checked_add(value_byte_length)
                .ok_or_else(|| format!("{path} BoundedMap entry byte length overflowed usize"))?;
            require_profile_collection_capacity(map.len(), entry_byte_length, path)?;
            let mut entries = Vec::with_capacity(map.len());
            for (key, value) in map {
                entries.push((
                    key.clone(),
                    encode_bounded_map_key(key, *key_byte_length, &format!("{path}.{key}"))?,
                    value,
                ));
            }
            entries.sort_by(|left, right| compare_bytes(&left.1, &right.1));

            writer.write_u32(
                u32::try_from(entries.len())
                    .map_err(|_| format!("{path} BoundedMap entry count must fit in u32"))?,
            );
            for (key, encoded_key, value) in entries {
                writer.write_bytes(&encoded_key);
                write_value(writer, value_shape, value, &format!("{path}.{key}"))?;
            }
            Ok(())
        }
        WarmShape::VariableMap { value_shape } => {
            let map = value
                .as_object()
                .ok_or_else(|| format!("{path} VariableMap value must be an object"))?;
            let minimum_entry_byte_length = 4_usize
                .checked_add(minimum_shape_byte_length(value_shape, path)?)
                .ok_or_else(|| format!("{path} VariableMap entry byte length overflowed usize"))?;
            require_profile_collection_capacity(map.len(), minimum_entry_byte_length, path)?;
            let mut entries = Vec::with_capacity(map.len());
            for (key, value) in map {
                entries.push((key.clone(), key.as_bytes().to_vec(), value));
            }
            entries.sort_by(|left, right| compare_bytes(&left.1, &right.1));

            writer.write_u32(
                u32::try_from(entries.len())
                    .map_err(|_| format!("{path} VariableMap entry count must fit in u32"))?,
            );
            for (key, encoded_key, value) in entries {
                writer.write_u32(
                    u32::try_from(encoded_key.len())
                        .map_err(|_| format!("{path}.{key} key byte length must fit in u32"))?,
                );
                writer.write_bytes(&encoded_key);
                write_value(writer, value_shape, value, &format!("{path}.{key}"))?;
            }
            Ok(())
        }
        WarmShape::FixedStringEncoded {
            byte_length,
            encoding,
        } => {
            let value = value
                .as_str()
                .ok_or_else(|| format!("{path} FixedStringEncoded value must be a string"))?;
            let bytes = encode_string(value, encoding, path)?;
            if bytes.len() > *byte_length as usize {
                return Err(format!(
                    "{path} FixedStringEncoded byte length must be <= {byte_length}"
                ));
            }
            writer.write_u16(bytes.len() as u16);
            writer.write_bytes(&bytes);
            Ok(())
        }
        WarmShape::VariableString => {
            let value = value
                .as_str()
                .ok_or_else(|| format!("{path} VariableString value must be a string"))?;
            let bytes = value.as_bytes();
            if bytes.len() > MAX_WARM_PAYLOAD_BYTE_LENGTH.saturating_sub(4) {
                return Err(format!(
                    "{path} VariableString byte length {} exceeds profile maximum {}",
                    bytes.len(),
                    MAX_WARM_PAYLOAD_BYTE_LENGTH - 4
                ));
            }
            writer.write_u32(
                u32::try_from(bytes.len())
                    .map_err(|_| format!("{path} VariableString byte length must fit in u32"))?,
            );
            writer.write_bytes(bytes);
            Ok(())
        }
    }
}

fn read_value(
    reader: &mut PayloadReader<'_>,
    shape: &WarmShape,
    path: &str,
) -> Result<Value, String> {
    match shape {
        WarmShape::FixedScalar {
            scalar_type,
            nan_sentinel,
        } => read_scalar(reader, *scalar_type, nan_sentinel.unwrap_or(false), path),
        WarmShape::FixedEnum { storage, variants } => {
            let offset = reader.offset;
            let discriminant = read_unsigned_storage(reader, *storage, path)?;
            let variant = variants.get(discriminant as usize).ok_or_else(|| {
                format!("{path} FixedEnum discriminant {discriminant} is outside declared variants at offset {offset}")
            })?;
            Ok(Value::String(variant.clone()))
        }
        WarmShape::FixedVector {
            element_type,
            length,
        } => {
            let element_byte_length = scalar_byte_length(*element_type);
            let required_byte_length = (*length as usize)
                .checked_mul(element_byte_length)
                .ok_or_else(|| format!("{path} FixedVector byte length overflowed usize"))?;
            reader.require_remaining(required_byte_length, path)?;
            let mut values = reserve_value_vector(*length as usize, path)?;
            for index in 0..*length {
                values.push(read_scalar(
                    reader,
                    *element_type,
                    false,
                    &format!("{path}.{index}"),
                )?);
            }
            Ok(Value::Array(values))
        }
        WarmShape::BoundedArray {
            element_type,
            max_length,
        } => {
            let offset = reader.offset;
            let live_count = reader.read_u32(&format!("{path}.liveCount"))?;
            if live_count > *max_length {
                return Err(format!(
                    "{path} BoundedArray liveCount {live_count} exceeds maxLength {max_length} at offset {offset}"
                ));
            }
            let required_byte_length = (live_count as usize)
                .checked_mul(scalar_byte_length(*element_type))
                .ok_or_else(|| format!("{path} BoundedArray byte length overflowed usize"))?;
            require_live_count_capacity(
                reader,
                live_count,
                required_byte_length,
                path,
                offset,
                "BoundedArray",
            )?;
            let mut values = reserve_value_vector(live_count as usize, path)?;
            for index in 0..live_count {
                values.push(read_scalar(
                    reader,
                    *element_type,
                    false,
                    &format!("{path}.{index}"),
                )?);
            }
            Ok(Value::Array(values))
        }
        WarmShape::BoundedMap {
            key_byte_length,
            max_entries,
            value_shape,
            ..
        } => {
            require_fixed_value_shape(value_shape, path)?;
            let offset = reader.offset;
            let live_count = reader.read_u32(&format!("{path}.liveCount"))?;
            if live_count > *max_entries {
                return Err(format!(
                    "{path} BoundedMap liveCount {live_count} exceeds maxEntries {max_entries} at offset {offset}"
                ));
            }

            let value_byte_length = fixed_shape_byte_length(value_shape, path)?;
            let entry_byte_length = (*key_byte_length as usize)
                .checked_add(value_byte_length)
                .ok_or_else(|| format!("{path} BoundedMap entry byte length overflowed usize"))?;
            let required_byte_length = (live_count as usize)
                .checked_mul(entry_byte_length)
                .ok_or_else(|| format!("{path} BoundedMap byte length overflowed usize"))?;
            require_live_count_capacity(
                reader,
                live_count,
                required_byte_length,
                path,
                offset,
                "BoundedMap",
            )?;

            let mut map = Map::new();
            let mut previous_key: Option<Vec<u8>> = None;
            for index in 0..live_count {
                let key_offset = reader.offset;
                let key_bytes =
                    reader.read_bytes(*key_byte_length as usize, &format!("{path}.{index}.key"))?;
                if previous_key
                    .as_ref()
                    .is_some_and(|previous| compare_bytes(previous, &key_bytes) != Ordering::Less)
                {
                    return Err(format!(
                        "{path}.{index}.key BoundedMap encoded keys must be strictly increasing at offset {key_offset}"
                    ));
                }

                let key =
                    decode_bounded_map_key(&key_bytes, &format!("{path}.{index}.key"), key_offset)?;
                let value = read_value(reader, value_shape, &format!("{path}.{key}"))?;
                map.insert(key, value);
                previous_key = Some(key_bytes);
            }
            Ok(Value::Object(map))
        }
        WarmShape::VariableMap { value_shape } => {
            let offset = reader.offset;
            let live_count = reader.read_u32(&format!("{path}.liveCount"))?;
            let minimum_entry_byte_length = 4_usize
                .checked_add(minimum_shape_byte_length(value_shape, path)?)
                .ok_or_else(|| format!("{path} VariableMap entry byte length overflowed usize"))?;
            let required_byte_length = (live_count as usize)
                .checked_mul(minimum_entry_byte_length)
                .ok_or_else(|| format!("{path} VariableMap byte length overflowed usize"))?;
            require_live_count_capacity(
                reader,
                live_count,
                required_byte_length,
                path,
                offset,
                "VariableMap",
            )?;
            let mut map = Map::new();
            let mut previous_key: Option<Vec<u8>> = None;
            for index in 0..live_count {
                let key_len = reader.read_u32(&format!("{path}.{index}.keyByteLength"))?;
                let key_offset = reader.offset;
                let key_bytes =
                    reader.read_bytes(key_len as usize, &format!("{path}.{index}.key"))?;
                if previous_key
                    .as_ref()
                    .is_some_and(|previous| compare_bytes(previous, &key_bytes) != Ordering::Less)
                {
                    return Err(format!(
                        "{path}.{index}.key VariableMap keys must be strictly increasing at offset {key_offset}"
                    ));
                }
                let key = String::from_utf8(key_bytes.clone()).map_err(|_| {
                    format!("{path}.{index}.key contains invalid UTF-8 at offset {key_offset}")
                })?;
                let value = read_value(reader, value_shape, &format!("{path}.{key}"))?;
                map.insert(key, value);
                previous_key = Some(key_bytes);
            }
            Ok(Value::Object(map))
        }
        WarmShape::FixedStringEncoded {
            byte_length,
            encoding,
        } => {
            let offset = reader.offset;
            let live_byte_length = reader.read_u16(&format!("{path}.liveByteLength"))?;
            if live_byte_length > *byte_length {
                return Err(format!(
                    "{path} FixedStringEncoded liveByteLength {live_byte_length} exceeds byteLength {byte_length} at offset {offset}"
                ));
            }
            let bytes = reader.read_bytes(live_byte_length as usize, &format!("{path}.bytes"))?;
            Ok(Value::String(decode_string(
                &bytes,
                encoding,
                path,
                offset + 2,
            )?))
        }
        WarmShape::VariableString => {
            let offset = reader.offset;
            let live_byte_length = reader.read_u32(&format!("{path}.liveByteLength"))?;
            let bytes = reader.read_bytes(live_byte_length as usize, &format!("{path}.bytes"))?;
            String::from_utf8(bytes)
                .map(Value::String)
                .map_err(|_| format!("{path} UTF-8 bytes are invalid at offset {}", offset + 4))
        }
    }
}

fn write_scalar(
    writer: &mut PayloadWriter,
    scalar_type: ScalarType,
    nan_sentinel: bool,
    value: &Value,
    path: &str,
) -> Result<(), String> {
    match scalar_type {
        ScalarType::Bool => {
            let value = value
                .as_bool()
                .ok_or_else(|| format!("{path} bool value must be a boolean"))?;
            writer.write_u8(if value { 1 } else { 0 });
        }
        ScalarType::U8 => writer.write_u8(require_u64(value, 0xff, path)? as u8),
        ScalarType::U16 => writer.write_u16(require_u64(value, 0xffff, path)? as u16),
        ScalarType::U32 => writer.write_u32(require_u64(value, 0xffff_ffff, path)? as u32),
        ScalarType::U64 => writer.write_u64(parse_fixture_u64(value, path)?),
        ScalarType::I8 => writer.write_i8(require_i64(value, -0x80, 0x7f, path)? as i8),
        ScalarType::I16 => writer.write_i16(require_i64(value, -0x8000, 0x7fff, path)? as i16),
        ScalarType::I32 => {
            writer.write_i32(require_i64(value, -0x8000_0000, 0x7fff_ffff, path)? as i32)
        }
        ScalarType::I64 => writer.write_i64(parse_fixture_i64(value, path)?),
        ScalarType::F32 => {
            let value = require_f64(value, nan_sentinel, path)?;
            if value.is_finite() && value.abs() > f32::MAX as f64 {
                return Err(format!("{path} f32 value must fit in IEEE-754 f32"));
            }
            writer.write_f32(value as f32);
        }
        ScalarType::F64 => writer.write_f64(require_f64(value, nan_sentinel, path)?),
    }
    Ok(())
}

fn read_scalar(
    reader: &mut PayloadReader<'_>,
    scalar_type: ScalarType,
    nan_sentinel: bool,
    path: &str,
) -> Result<Value, String> {
    match scalar_type {
        ScalarType::Bool => {
            let offset = reader.offset;
            match reader.read_u8(path)? {
                0 => Ok(Value::Bool(false)),
                1 => Ok(Value::Bool(true)),
                other => Err(format!(
                    "{path} bool byte must be 0x00 or 0x01, got 0x{other:02x} at offset {offset}"
                )),
            }
        }
        ScalarType::U8 => Ok(number_u64(reader.read_u8(path)? as u64)),
        ScalarType::U16 => Ok(number_u64(reader.read_u16(path)? as u64)),
        ScalarType::U32 => Ok(number_u64(reader.read_u32(path)? as u64)),
        ScalarType::U64 => Ok(Value::String(hex::format_u64_hex(reader.read_u64(path)?))),
        ScalarType::I8 => Ok(number_i64(reader.read_i8(path)? as i64)),
        ScalarType::I16 => Ok(number_i64(reader.read_i16(path)? as i64)),
        ScalarType::I32 => Ok(number_i64(reader.read_i32(path)? as i64)),
        ScalarType::I64 => Ok(Value::String(hex::format_u64_hex(
            reader.read_i64(path)? as u64
        ))),
        ScalarType::F32 => {
            let offset = reader.offset;
            let value = reader.read_f32(path)? as f64;
            validate_float(value, nan_sentinel, path, offset)?;
            number_f64(value, path)
        }
        ScalarType::F64 => {
            let offset = reader.offset;
            let value = reader.read_f64(path)?;
            validate_float(value, nan_sentinel, path, offset)?;
            number_f64(value, path)
        }
    }
}

fn write_unsigned_storage(
    writer: &mut PayloadWriter,
    storage: EnumStorage,
    value: u32,
    path: &str,
) -> Result<(), String> {
    match storage {
        EnumStorage::U8 => writer.write_u8(
            u8::try_from(value)
                .map_err(|_| format!("{path} FixedEnum discriminant exceeds u8 storage"))?,
        ),
        EnumStorage::U16 => writer.write_u16(
            u16::try_from(value)
                .map_err(|_| format!("{path} FixedEnum discriminant exceeds u16 storage"))?,
        ),
        EnumStorage::U32 => writer.write_u32(value),
    }
    Ok(())
}

fn read_unsigned_storage(
    reader: &mut PayloadReader<'_>,
    storage: EnumStorage,
    path: &str,
) -> Result<u32, String> {
    match storage {
        EnumStorage::U8 => Ok(reader.read_u8(path)? as u32),
        EnumStorage::U16 => Ok(reader.read_u16(path)? as u32),
        EnumStorage::U32 => reader.read_u32(path),
    }
}

fn require_fixed_value_shape(shape: &WarmShape, path: &str) -> Result<(), String> {
    match shape {
        WarmShape::FixedScalar { .. }
        | WarmShape::FixedEnum { .. }
        | WarmShape::FixedVector { .. } => Ok(()),
        _ => Err(format!(
            "{path} BoundedMap valueShape must be FixedScalar, FixedEnum, or FixedVector"
        )),
    }
}

fn fixed_shape_byte_length(shape: &WarmShape, path: &str) -> Result<usize, String> {
    match shape {
        WarmShape::FixedScalar { scalar_type, .. } => Ok(scalar_byte_length(*scalar_type)),
        WarmShape::FixedEnum { storage, .. } => Ok(enum_storage_byte_length(*storage)),
        WarmShape::FixedVector {
            element_type,
            length,
        } => (*length as usize)
            .checked_mul(scalar_byte_length(*element_type))
            .ok_or_else(|| format!("{path} FixedVector byte length overflowed usize")),
        _ => Err(format!(
            "{path} BoundedMap valueShape must be FixedScalar, FixedEnum, or FixedVector"
        )),
    }
}

fn minimum_shape_byte_length(shape: &WarmShape, path: &str) -> Result<usize, String> {
    match shape {
        WarmShape::FixedScalar { scalar_type, .. } => Ok(scalar_byte_length(*scalar_type)),
        WarmShape::FixedEnum { storage, .. } => Ok(enum_storage_byte_length(*storage)),
        WarmShape::FixedVector {
            element_type,
            length,
        } => (*length as usize)
            .checked_mul(scalar_byte_length(*element_type))
            .ok_or_else(|| format!("{path} FixedVector byte length overflowed usize")),
        WarmShape::BoundedArray { .. }
        | WarmShape::BoundedMap { .. }
        | WarmShape::VariableMap { .. }
        | WarmShape::VariableString => Ok(4),
        WarmShape::FixedStringEncoded { .. } => Ok(2),
    }
}

fn require_profile_collection_capacity(
    count: usize,
    item_byte_length: usize,
    path: &str,
) -> Result<(), String> {
    let body_byte_length = count
        .checked_mul(item_byte_length)
        .ok_or_else(|| format!("{path} collection byte length overflowed usize"))?;
    let byte_length = 4_usize
        .checked_add(body_byte_length)
        .ok_or_else(|| format!("{path} collection byte length overflowed usize"))?;
    if byte_length > MAX_WARM_PAYLOAD_BYTE_LENGTH {
        return Err(format!(
            "{path} collection minimum byte length {byte_length} exceeds profile maximum {MAX_WARM_PAYLOAD_BYTE_LENGTH}"
        ));
    }
    Ok(())
}

fn require_live_count_capacity(
    reader: &PayloadReader<'_>,
    live_count: u32,
    required_byte_length: usize,
    path: &str,
    count_offset: usize,
    label: &str,
) -> Result<(), String> {
    let remaining = reader.remaining();
    if required_byte_length > remaining {
        return Err(format!(
            "{path} {label} liveCount {live_count} requires at least {required_byte_length} payload byte(s), but only {remaining} remain at offset {count_offset}"
        ));
    }
    Ok(())
}

fn reserve_value_vector(count: usize, path: &str) -> Result<Vec<Value>, String> {
    let mut values = Vec::new();
    values
        .try_reserve_exact(count)
        .map_err(|_| format!("{path} decoded value capacity {count} could not be reserved"))?;
    Ok(values)
}

fn encode_bounded_map_key(key: &str, key_byte_length: u16, path: &str) -> Result<Vec<u8>, String> {
    if !key.is_ascii() {
        return Err(format!("{path} BoundedMap key must be ASCII"));
    }
    let bytes = key.as_bytes();
    if bytes.contains(&0) {
        return Err(format!("{path} BoundedMap key must not contain NUL bytes"));
    }
    if bytes.len() > key_byte_length as usize {
        return Err(format!(
            "{path} BoundedMap key byte length must be <= {key_byte_length}"
        ));
    }

    let mut padded = vec![0_u8; key_byte_length as usize];
    padded[..bytes.len()].copy_from_slice(bytes);
    Ok(padded)
}

fn decode_bounded_map_key(bytes: &[u8], path: &str, offset: usize) -> Result<String, String> {
    let mut live_length = bytes.len();
    for (index, byte) in bytes.iter().copied().enumerate() {
        if byte == 0 {
            live_length = index;
            break;
        }
        if byte > 0x7f {
            return Err(format!(
                "{path} BoundedMap key contains a non-ASCII byte at offset {}",
                offset + index
            ));
        }
    }

    for (index, byte) in bytes.iter().copied().enumerate().skip(live_length) {
        if byte != 0 {
            return Err(format!(
                "{path} BoundedMap key has non-zero padding at offset {}",
                offset + index
            ));
        }
    }

    String::from_utf8(bytes[..live_length].to_vec())
        .map_err(|_| format!("{path} BoundedMap key bytes are not valid UTF-8"))
}

fn encode_string(value: &str, encoding: &str, path: &str) -> Result<Vec<u8>, String> {
    match encoding {
        "ascii" => {
            if !value.is_ascii() {
                return Err(format!(
                    "{path} ascii string contains a non-ASCII code unit"
                ));
            }
            Ok(value.as_bytes().to_vec())
        }
        "utf8" => Ok(value.as_bytes().to_vec()),
        other => Err(format!("{path} unsupported string encoding {other}")),
    }
}

fn decode_string(
    bytes: &[u8],
    encoding: &str,
    path: &str,
    offset: usize,
) -> Result<String, String> {
    match encoding {
        "ascii" => {
            for (index, byte) in bytes.iter().copied().enumerate() {
                if byte > 0x7f {
                    return Err(format!(
                        "{path} ascii string contains a non-ASCII byte at offset {}",
                        offset + index
                    ));
                }
            }
            String::from_utf8(bytes.to_vec())
                .map_err(|_| format!("{path} ascii bytes are not valid UTF-8"))
        }
        "utf8" => String::from_utf8(bytes.to_vec())
            .map_err(|_| format!("{path} UTF-8 bytes are invalid at offset {offset}")),
        other => Err(format!("{path} unsupported string encoding {other}")),
    }
}

fn require_u64(value: &Value, max: u64, path: &str) -> Result<u64, String> {
    let value = value
        .as_u64()
        .ok_or_else(|| format!("{path} integer value must be unsigned"))?;
    if value > max {
        return Err(format!("{path} integer value must be <= {max}"));
    }
    Ok(value)
}

fn require_i64(value: &Value, min: i64, max: i64, path: &str) -> Result<i64, String> {
    let value = value
        .as_i64()
        .ok_or_else(|| format!("{path} integer value must be signed"))?;
    if value < min || value > max {
        return Err(format!(
            "{path} integer value must be in range [{min}, {max}]"
        ));
    }
    Ok(value)
}

fn require_f64(value: &Value, nan_sentinel: bool, path: &str) -> Result<f64, String> {
    let value = value
        .as_f64()
        .ok_or_else(|| format!("{path} floating scalar value must be a number"))?;
    if value.is_finite() || (nan_sentinel && value.is_nan()) {
        Ok(value)
    } else {
        Err(format!("{path} floating scalar value must be finite"))
    }
}

fn parse_fixture_u64(value: &Value, path: &str) -> Result<u64, String> {
    if let Some(value) = value.as_str() {
        return hex::parse_u64_hex(value, path);
    }
    require_u64(value, u64::MAX, path)
}

fn parse_fixture_i64(value: &Value, path: &str) -> Result<i64, String> {
    if let Some(value) = value.as_str() {
        return Ok(hex::parse_u64_hex(value, path)? as i64);
    }
    value
        .as_i64()
        .ok_or_else(|| format!("{path} i64 value must be an integer or 16-character hex string"))
}

fn validate_float(value: f64, nan_sentinel: bool, path: &str, offset: usize) -> Result<(), String> {
    if value.is_finite() || (nan_sentinel && value.is_nan()) {
        Ok(())
    } else {
        Err(format!(
            "{path} floating scalar bytes decode to a non-finite value at offset {offset}"
        ))
    }
}

fn number_u64(value: u64) -> Value {
    Value::Number(Number::from(value))
}

fn number_i64(value: i64) -> Value {
    Value::Number(Number::from(value))
}

fn number_f64(value: f64, path: &str) -> Result<Value, String> {
    Number::from_f64(value)
        .map(Value::Number)
        .ok_or_else(|| format!("{path} decoded floating value cannot be represented as JSON"))
}

fn numbers_equivalent(left: &Number, right: &Number) -> bool {
    if left == right {
        return true;
    }
    match (left.as_f64(), right.as_f64()) {
        (Some(left), Some(right)) => left == right,
        _ => false,
    }
}

fn compare_bytes(left: &[u8], right: &[u8]) -> Ordering {
    left.cmp(right)
}

struct PayloadWriter {
    bytes: Vec<u8>,
    overflowed: bool,
}

impl PayloadWriter {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            overflowed: false,
        }
    }

    fn write_u8(&mut self, value: u8) {
        self.write_bytes(&[value]);
    }

    fn write_i8(&mut self, value: i8) {
        self.write_bytes(&[value as u8]);
    }

    fn write_u16(&mut self, value: u16) {
        self.write_bytes(&value.to_le_bytes());
    }

    fn write_i16(&mut self, value: i16) {
        self.write_bytes(&value.to_le_bytes());
    }

    fn write_u32(&mut self, value: u32) {
        self.write_bytes(&value.to_le_bytes());
    }

    fn write_i32(&mut self, value: i32) {
        self.write_bytes(&value.to_le_bytes());
    }

    fn write_u64(&mut self, value: u64) {
        self.write_bytes(&value.to_le_bytes());
    }

    fn write_i64(&mut self, value: i64) {
        self.write_bytes(&value.to_le_bytes());
    }

    fn write_f32(&mut self, value: f32) {
        self.write_bytes(&value.to_le_bytes());
    }

    fn write_f64(&mut self, value: f64) {
        self.write_bytes(&value.to_le_bytes());
    }

    fn write_bytes(&mut self, bytes: &[u8]) {
        if self.overflowed {
            return;
        }
        let Some(next_byte_length) = self.bytes.len().checked_add(bytes.len()) else {
            self.overflowed = true;
            return;
        };
        if next_byte_length > MAX_WARM_PAYLOAD_BYTE_LENGTH {
            self.overflowed = true;
            return;
        }
        self.bytes.extend_from_slice(bytes);
    }

    fn into_bytes(self) -> Result<Vec<u8>, String> {
        if self.overflowed {
            Err(format!(
                "warm snapshot payload exceeds profile maximum {MAX_WARM_PAYLOAD_BYTE_LENGTH}"
            ))
        } else {
            Ok(self.bytes)
        }
    }
}

struct PayloadReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> PayloadReader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn remaining(&self) -> usize {
        self.bytes.len().saturating_sub(self.offset)
    }

    fn read_u8(&mut self, path: &str) -> Result<u8, String> {
        self.require_remaining(1, path)?;
        let value = self.bytes[self.offset];
        self.offset += 1;
        Ok(value)
    }

    fn read_i8(&mut self, path: &str) -> Result<i8, String> {
        Ok(self.read_u8(path)? as i8)
    }

    fn read_u16(&mut self, path: &str) -> Result<u16, String> {
        Ok(u16::from_le_bytes(self.read_fixed::<2>(path)?))
    }

    fn read_i16(&mut self, path: &str) -> Result<i16, String> {
        Ok(i16::from_le_bytes(self.read_fixed::<2>(path)?))
    }

    fn read_u32(&mut self, path: &str) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.read_fixed::<4>(path)?))
    }

    fn read_i32(&mut self, path: &str) -> Result<i32, String> {
        Ok(i32::from_le_bytes(self.read_fixed::<4>(path)?))
    }

    fn read_u64(&mut self, path: &str) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.read_fixed::<8>(path)?))
    }

    fn read_i64(&mut self, path: &str) -> Result<i64, String> {
        Ok(i64::from_le_bytes(self.read_fixed::<8>(path)?))
    }

    fn read_f32(&mut self, path: &str) -> Result<f32, String> {
        Ok(f32::from_le_bytes(self.read_fixed::<4>(path)?))
    }

    fn read_f64(&mut self, path: &str) -> Result<f64, String> {
        Ok(f64::from_le_bytes(self.read_fixed::<8>(path)?))
    }

    fn read_bytes(&mut self, byte_length: usize, path: &str) -> Result<Vec<u8>, String> {
        self.require_remaining(byte_length, path)?;
        let value = self.bytes[self.offset..self.offset + byte_length].to_vec();
        self.offset += byte_length;
        Ok(value)
    }

    fn read_fixed<const N: usize>(&mut self, path: &str) -> Result<[u8; N], String> {
        self.require_remaining(N, path)?;
        let mut out = [0_u8; N];
        out.copy_from_slice(&self.bytes[self.offset..self.offset + N]);
        self.offset += N;
        Ok(out)
    }

    fn require_remaining(&self, byte_length: usize, path: &str) -> Result<(), String> {
        if self.offset > self.bytes.len().saturating_sub(byte_length) {
            return Err(format!(
                "{path} payload ended before {byte_length} byte(s) could be read at offset {}",
                self.offset
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decode_warm_snapshot_payload, encode_warm_snapshot_payload, WarmManifest,
        MAX_MANIFEST_SHAPE_DEPTH, MAX_WARM_PAYLOAD_BYTE_LENGTH,
    };
    use serde_json::{json, Value};

    fn manifest(shape: Value) -> WarmManifest {
        serde_json::from_value(json!({
            "codec": "framed-snapshot",
            "fields": [{ "dotPath": "value", "shape": shape }]
        }))
        .unwrap()
    }

    #[test]
    fn bounded_array_live_count_must_fit_remaining_payload_before_reservation() {
        let manifest = manifest(json!({
            "kind": "BoundedArray",
            "elementType": "u64",
            "maxLength": 16
        }));
        let bytes = 16_u32.to_le_bytes();

        assert_eq!(
            decode_warm_snapshot_payload(&manifest, &bytes).unwrap_err(),
            "payload.value BoundedArray liveCount 16 requires at least 128 payload byte(s), but only 0 remain at offset 0"
        );
    }

    #[test]
    fn bounded_map_live_count_must_fit_fixed_entries_before_key_allocation() {
        let manifest = manifest(json!({
            "kind": "BoundedMap",
            "keyByteLength": 4,
            "maxEntries": 8,
            "valueShape": { "kind": "FixedScalar", "type": "u32" }
        }));
        let bytes = 8_u32.to_le_bytes();

        assert_eq!(
            decode_warm_snapshot_payload(&manifest, &bytes).unwrap_err(),
            "payload.value BoundedMap liveCount 8 requires at least 64 payload byte(s), but only 0 remain at offset 0"
        );
    }

    #[test]
    fn variable_map_live_count_is_bounded_by_minimum_recursive_entry_size() {
        let manifest = manifest(json!({
            "kind": "VariableMap",
            "valueShape": { "kind": "VariableString" }
        }));
        let bytes = u32::MAX.to_le_bytes();

        let error = decode_warm_snapshot_payload(&manifest, &bytes).unwrap_err();
        assert!(
            error.starts_with("payload.value VariableMap liveCount 4294967295 requires at least ")
        );
        assert!(error.ends_with(" payload byte(s), but only 0 remain at offset 0"));
    }

    #[test]
    fn fixed_vector_and_bounded_maxima_cannot_exceed_the_one_mib_profile() {
        let oversized_vector = manifest(json!({
            "kind": "FixedVector",
            "elementType": "u8",
            "length": MAX_WARM_PAYLOAD_BYTE_LENGTH + 1
        }));
        let vector_error = decode_warm_snapshot_payload(&oversized_vector, &[]).unwrap_err();
        assert!(vector_error.contains("manifest.fields.0.shape.length encoded byte length"));
        assert!(vector_error.contains("exceeds profile maximum 1048576"));

        let oversized_array = manifest(json!({
            "kind": "BoundedArray",
            "elementType": "u8",
            "maxLength": MAX_WARM_PAYLOAD_BYTE_LENGTH
        }));
        let array_error = decode_warm_snapshot_payload(&oversized_array, &[]).unwrap_err();
        assert!(array_error.contains("manifest.fields.0.shape encoded byte length 1048580"));
        assert!(array_error.contains("exceeds profile maximum 1048576"));
    }

    #[test]
    fn nested_enum_variant_count_is_validated_against_storage_width() {
        let variants = (0..=u8::MAX)
            .map(|index| Value::String(format!("variant-{index}")))
            .chain(std::iter::once(Value::String("truncated".to_string())))
            .collect::<Vec<_>>();
        let manifest = manifest(json!({
            "kind": "VariableMap",
            "valueShape": {
                "kind": "FixedEnum",
                "storage": "u8",
                "variants": variants
            }
        }));

        assert_eq!(
            decode_warm_snapshot_payload(&manifest, &[]).unwrap_err(),
            "manifest.fields.0.shape.valueShape.variants count 257 exceeds declared U8 storage capacity 256"
        );
    }

    #[test]
    fn enum_discriminants_at_the_storage_boundary_do_not_truncate() {
        let variants = (0..=u8::MAX)
            .map(|index| Value::String(format!("variant-{index}")))
            .collect::<Vec<_>>();
        let manifest = manifest(json!({
            "kind": "FixedEnum",
            "storage": "u8",
            "variants": variants
        }));
        let snapshot = json!({ "value": "variant-255" });

        let encoded = encode_warm_snapshot_payload(&manifest, &snapshot).unwrap();
        assert_eq!(encoded, [u8::MAX]);
        assert_eq!(
            decode_warm_snapshot_payload(&manifest, &encoded).unwrap(),
            snapshot
        );
    }

    #[test]
    fn recursive_manifest_validation_rejects_duplicate_enum_variants() {
        let manifest = manifest(json!({
            "kind": "VariableMap",
            "valueShape": {
                "kind": "VariableMap",
                "valueShape": {
                    "kind": "FixedEnum",
                    "storage": "u16",
                    "variants": ["ready", "ready"]
                }
            }
        }));

        assert_eq!(
            decode_warm_snapshot_payload(&manifest, &[]).unwrap_err(),
            "manifest.fields.0.shape.valueShape.valueShape.variants.1 duplicates FixedEnum variant \"ready\""
        );
    }

    #[test]
    fn recursive_manifest_depth_is_capped_before_unbounded_walk() {
        let mut shape = json!({ "kind": "VariableString" });
        for _ in 0..MAX_MANIFEST_SHAPE_DEPTH {
            shape = json!({ "kind": "VariableMap", "valueShape": shape });
        }
        let manifest = manifest(shape);

        let error = decode_warm_snapshot_payload(&manifest, &[]).unwrap_err();
        assert!(error.ends_with("exceeds maximum manifest shape depth 64"));
    }

    #[test]
    fn nan_sentinel_is_rejected_at_the_json_profile_boundary() {
        let manifest = manifest(json!({
            "kind": "FixedScalar",
            "type": "f64",
            "nanSentinel": true
        }));
        let expected =
            "manifest.fields.0.shape.nanSentinel is unsupported by the Rust JSON value profile";

        assert_eq!(
            encode_warm_snapshot_payload(&manifest, &json!({ "value": 1.0 })).unwrap_err(),
            expected
        );
        assert_eq!(
            decode_warm_snapshot_payload(&manifest, &1_f64.to_le_bytes()).unwrap_err(),
            expected
        );
    }

    #[test]
    fn false_nan_sentinel_is_rejected_like_the_typescript_manifest() {
        let manifest = manifest(json!({
            "kind": "FixedScalar",
            "type": "f64",
            "nanSentinel": false
        }));

        assert_eq!(
            decode_warm_snapshot_payload(&manifest, &[]).unwrap_err(),
            "manifest.fields.0.shape.nanSentinel must be true when present"
        );
    }

    #[test]
    fn null_optional_shape_properties_are_not_treated_as_absent() {
        let nan_manifest = serde_json::from_value::<WarmManifest>(json!({
            "fields": [{
                "dotPath": "value",
                "shape": {
                    "kind": "FixedScalar",
                    "type": "f64",
                    "nanSentinel": null
                }
            }]
        }));
        assert!(nan_manifest
            .unwrap_err()
            .to_string()
            .contains("expected a boolean"));

        let key_encoding_manifest = serde_json::from_value::<WarmManifest>(json!({
            "fields": [{
                "dotPath": "value",
                "shape": {
                    "kind": "BoundedMap",
                    "keyByteLength": 4,
                    "keyEncoding": null,
                    "maxEntries": 1,
                    "valueShape": { "kind": "FixedScalar", "type": "u8" }
                }
            }]
        }));
        assert!(key_encoding_manifest
            .unwrap_err()
            .to_string()
            .contains("expected a string"));
    }

    #[test]
    fn payload_input_and_output_are_capped_to_the_one_mib_profile() {
        let scalar_manifest = manifest(json!({ "kind": "FixedScalar", "type": "u8" }));
        let oversized_payload = vec![0_u8; MAX_WARM_PAYLOAD_BYTE_LENGTH + 1];
        assert_eq!(
            decode_warm_snapshot_payload(&scalar_manifest, &oversized_payload).unwrap_err(),
            "warm snapshot payload byte length 1048577 exceeds profile maximum 1048576"
        );

        let string_manifest = manifest(json!({ "kind": "VariableString" }));
        let oversized_string = "a".repeat(MAX_WARM_PAYLOAD_BYTE_LENGTH - 3);
        assert_eq!(
            encode_warm_snapshot_payload(&string_manifest, &json!({ "value": oversized_string }))
                .unwrap_err(),
            "snapshot.value VariableString byte length 1048573 exceeds profile maximum 1048572"
        );
    }
}
