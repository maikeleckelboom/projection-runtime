use crate::hex;
use serde::Deserialize;
use serde_json::{Map, Number, Value};
use std::cmp::Ordering;

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
        #[serde(default, rename = "nanSentinel")]
        nan_sentinel: bool,
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
        #[serde(default, rename = "keyEncoding")]
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

    Ok(writer.into_bytes())
}

pub fn decode_warm_snapshot_payload(
    manifest: &WarmManifest,
    bytes: &[u8],
) -> Result<Value, String> {
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

    let mut fields: Vec<&WarmField> = manifest.fields.iter().collect();
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
        } => write_scalar(writer, *scalar_type, *nan_sentinel, value, path),
        WarmShape::FixedEnum { storage, variants } => {
            let value = value
                .as_str()
                .ok_or_else(|| format!("{path} FixedEnum value must be a string variant"))?;
            let index = variants
                .iter()
                .position(|variant| variant == value)
                .ok_or_else(|| format!("{path} unknown FixedEnum variant {value:?}"))?;
            write_unsigned_storage(writer, *storage, index as u32);
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
            writer.write_u32(values.len() as u32);
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
            let mut entries = Vec::with_capacity(map.len());
            for (key, value) in map {
                entries.push((
                    key.clone(),
                    encode_bounded_map_key(key, *key_byte_length, &format!("{path}.{key}"))?,
                    value,
                ));
            }
            entries.sort_by(|left, right| compare_bytes(&left.1, &right.1));

            writer.write_u32(entries.len() as u32);
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
            let mut entries = Vec::with_capacity(map.len());
            for (key, value) in map {
                entries.push((key.clone(), key.as_bytes().to_vec(), value));
            }
            entries.sort_by(|left, right| compare_bytes(&left.1, &right.1));

            writer.write_u32(entries.len() as u32);
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
        } => read_scalar(reader, *scalar_type, *nan_sentinel, path),
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
            let mut values = Vec::with_capacity(*length as usize);
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
            let mut values = Vec::with_capacity(live_count as usize);
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
            let live_count = reader.read_u32(&format!("{path}.liveCount"))?;
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

fn write_unsigned_storage(writer: &mut PayloadWriter, storage: EnumStorage, value: u32) {
    match storage {
        EnumStorage::U8 => writer.write_u8(value as u8),
        EnumStorage::U16 => writer.write_u16(value as u16),
        EnumStorage::U32 => writer.write_u32(value),
    }
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
}

impl PayloadWriter {
    fn new() -> Self {
        Self { bytes: Vec::new() }
    }

    fn write_u8(&mut self, value: u8) {
        self.bytes.push(value);
    }

    fn write_i8(&mut self, value: i8) {
        self.bytes.push(value as u8);
    }

    fn write_u16(&mut self, value: u16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_i16(&mut self, value: i16) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_u32(&mut self, value: u32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_i32(&mut self, value: i32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_u64(&mut self, value: u64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_i64(&mut self, value: i64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_f32(&mut self, value: f32) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_f64(&mut self, value: f64) {
        self.bytes.extend_from_slice(&value.to_le_bytes());
    }

    fn write_bytes(&mut self, bytes: &[u8]) {
        self.bytes.extend_from_slice(bytes);
    }

    fn into_bytes(self) -> Vec<u8> {
        self.bytes
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
