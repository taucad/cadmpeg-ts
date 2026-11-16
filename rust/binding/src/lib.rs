// SPDX-License-Identifier: Apache-2.0
//! Bytes-in, bytes-out conversion over the cadmpeg registry.
//!
//! This crate is the whole engine surface of `cadmpeg-ts`. The WASM and NAPI
//! shells forward to it and add nothing but their host's types, so both
//! backends run the same code and produce the same bytes. The cargo features
//! choose which codecs a build carries; the conversion itself follows the
//! cadmpeg command line's `convert` workflow: detect, decode at the depth the
//! encoder needs, plan, write.

use std::io::Cursor;

use cadmpeg_core::decode::{DecodeArena, DecodeContext, View};
use cadmpeg_core::CodecError;
use cadmpeg_ir::codec::write::target::TargetRequest;
use cadmpeg_ir::codec::write::EncodeInput;
use cadmpeg_ir::codec::{DecodeFailure, DecodeOptions};
use cadmpeg_ir::report::loss::LossNote;
use cadmpeg_ir::{CadIr, SourceFidelity};
use cadmpeg_registry::{
    build_encoder, headline_level, Format, InputCatalog, ResolveSourceError, ResolvedSource,
    DETECTION_PREFIX_LEN,
};
use serde::Serialize;

/// Stable error codes shared with the TypeScript `CadmpegError`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    /// No codec in this build recognizes the input, or the output format is
    /// not one this build writes.
    UnsupportedFormat,
    /// The options are malformed, such as an empty dialect after `step:`.
    InvalidOptions,
    /// The input was recognized but could not be decoded.
    ImportFailed,
    /// The document decoded but the writer could not plan or write it.
    ExportFailed,
    /// cadmpeg declined the conversion: an unsupported target, insufficient
    /// decode depth, or a strict-mode loss.
    Refused,
    /// A `DecodePolicy` resource limit stopped the decode.
    LimitExceeded,
    /// An invariant of this binding failed.
    Internal,
}

/// The conversion phase a loss or failure belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    /// Reading the source file into the neutral document.
    Decode,
    /// Planning and writing the output file.
    Export,
}

/// A failed conversion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BindingError {
    /// Stable machine-readable code.
    pub code: ErrorCode,
    /// cadmpeg's own explanation.
    pub message: String,
    /// The phase that failed, when one did.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phase: Option<Phase>,
}

impl BindingError {
    fn new(code: ErrorCode, phase: Option<Phase>, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            phase,
        }
    }

    /// The error as one JSON object, the form both shells hand to JavaScript.
    #[must_use]
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            String::from(r#"{"code":"INTERNAL","message":"unserializable binding error"}"#)
        })
    }
}

impl std::fmt::Display for BindingError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for BindingError {}

/// One loss cadmpeg reported, tagged with the phase that reported it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Loss {
    /// The phase that reported the loss.
    pub phase: Phase,
    /// cadmpeg's loss note: `code`, `severity`, `message`, `provenance`.
    #[serde(flatten)]
    pub note: LossNote,
}

/// What a conversion transferred and lost.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// Input format id, such as `sldprt`, or `cadir` for a CADIR document.
    pub from: String,
    /// Output format id.
    pub to: String,
    /// Every decode and export loss, decode first, in cadmpeg's order.
    pub losses: Vec<Loss>,
    /// cadmpeg's informational notes, decode first.
    pub notes: Vec<String>,
}

/// A completed conversion.
#[derive(Debug, Clone, PartialEq)]
pub struct Conversion {
    /// The written file.
    pub bytes: Vec<u8>,
    /// What the conversion transferred and lost.
    pub report: Report,
}

/// One readable format in this build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputFormat {
    /// Format id.
    pub id: String,
    /// Lowercase file extensions, without the dot.
    pub extensions: Vec<String>,
    /// cadmpeg's headline support level for the format, when it records one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
}

/// One writable format in this build.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputFormat {
    /// Format id, as `to` accepts it.
    pub id: String,
    /// Whether the written file is binary.
    pub binary: bool,
}

/// The formats this build reads and writes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Capabilities {
    /// cadmpeg release the engine was built from.
    pub engine: String,
    /// Readable formats.
    pub inputs: Vec<InputFormat>,
    /// Writable formats.
    pub outputs: Vec<OutputFormat>,
}

/// The cadmpeg release this binding is pinned to.
pub const ENGINE_VERSION: &str = "0.6.12";

/// Lists the formats this build reads and writes.
#[must_use]
pub fn capabilities() -> Capabilities {
    let catalog = InputCatalog::with_builtins();
    let inputs = catalog
        .descriptors()
        .map(|descriptor| {
            let id = descriptor.format_id().as_str().to_owned();
            InputFormat {
                level: headline_level(&id).ok().flatten(),
                extensions: descriptor
                    .extensions()
                    .iter()
                    .map(|extension| (*extension).to_owned())
                    .collect(),
                id,
            }
        })
        .collect();
    let outputs = Format::all()
        .map(|format| OutputFormat {
            id: format.name().as_str().to_owned(),
            binary: format.is_binary(),
        })
        .collect();
    Capabilities {
        engine: ENGINE_VERSION.to_owned(),
        inputs,
        outputs,
    }
}

/// Splits `to` into an output format and an optional dialect, as the cadmpeg
/// command line reads `--to`: `step`, or `step:ap242`.
fn select_output(to: &str) -> Result<(Format, Option<&str>), BindingError> {
    let (name, dialect) = match to.split_once(':') {
        Some((_, "")) => {
            return Err(BindingError::new(
                ErrorCode::InvalidOptions,
                None,
                format!("to: {to}: nothing after the colon"),
            ));
        }
        Some((name, dialect)) => (name, Some(dialect)),
        None => (to, None),
    };
    let format = Format::from_name(name)
        .map_err(|error| BindingError::new(ErrorCode::Internal, None, error.to_string()))?
        .ok_or_else(|| {
            BindingError::new(
                ErrorCode::UnsupportedFormat,
                Some(Phase::Export),
                format!(
                    "{name} is not an output format of this build; available: {}",
                    Format::vocabulary()
                ),
            )
        })?;
    Ok((format, dialect))
}

fn codec_error(error: &CodecError, phase: Phase) -> BindingError {
    let code = match error {
        CodecError::ResourceLimit(_) => ErrorCode::LimitExceeded,
        CodecError::UnsupportedTarget(_) | CodecError::InsufficientDepth { .. } => {
            ErrorCode::Refused
        }
        CodecError::UnsupportedDialect { .. } | CodecError::NotImplemented(_) => {
            ErrorCode::UnsupportedFormat
        }
        _ => match phase {
            Phase::Decode => ErrorCode::ImportFailed,
            Phase::Export => ErrorCode::ExportFailed,
        },
    };
    BindingError::new(code, Some(phase), error.to_string())
}

struct Decoded {
    from: String,
    ir: CadIr,
    fidelity: Option<SourceFidelity>,
    losses: Vec<LossNote>,
    notes: Vec<String>,
}

fn decode(input: &[u8], options: &DecodeOptions) -> Result<Decoded, BindingError> {
    let decode_error = |error: &CodecError| codec_error(error, Phase::Decode);
    let catalog = InputCatalog::with_builtins();
    let arena = DecodeArena::new();
    let ctx = DecodeContext::new(&arena, &options.policy, options.depth);
    let mut source = Cursor::new(input);
    let mut prefix = cadmpeg_container::compound::read_detection_prefix(
        &ctx,
        &mut source,
        DETECTION_PREFIX_LEN,
    )
    .map_err(|error| decode_error(&error))?;
    let resolved = catalog
        .resolve_seekable_source(&ctx, View::over_retained(&prefix), &mut source, None)
        .map_err(|error| match error {
            ResolveSourceError::Codec(error) => decode_error(&error),
            error => BindingError::new(
                ErrorCode::UnsupportedFormat,
                Some(Phase::Decode),
                error.to_string(),
            ),
        })?;
    match resolved {
        ResolvedSource::Native { codec, .. } => {
            let from = codec.id().as_str().to_owned();
            ctx.complete_input(&mut source, &mut prefix)
                .map_err(|error| decode_error(&error))?;
            let result = codec.decode_with_context(&ctx, View::over_retained(&prefix));
            ctx.finish_session().map_err(|error| decode_error(&error))?;
            let result = result.map_err(|failure| match failure {
                DecodeFailure::Codec(error) => decode_error(&error),
                failure => BindingError::new(
                    ErrorCode::Refused,
                    Some(Phase::Decode),
                    failure.to_string(),
                ),
            })?;
            let (ir, report, fidelity) = result.into_parts();
            Ok(Decoded {
                from,
                ir,
                fidelity: Some(fidelity),
                losses: report.losses,
                notes: report.notes,
            })
        }
        ResolvedSource::Cadir => {
            ctx.complete_input(&mut source, &mut prefix)
                .map_err(|error| decode_error(&error))?;
            ctx.finish_session().map_err(|error| decode_error(&error))?;
            let text = std::str::from_utf8(&prefix).map_err(|error| {
                BindingError::new(
                    ErrorCode::ImportFailed,
                    Some(Phase::Decode),
                    format!("invalid CADIR UTF-8: {error}"),
                )
            })?;
            let ir = CadIr::from_json(text).map_err(|error| {
                BindingError::new(
                    ErrorCode::ImportFailed,
                    Some(Phase::Decode),
                    format!("not a recognized CAD file nor a valid CADIR document: {error}"),
                )
            })?;
            Ok(Decoded {
                from: String::from("cadir"),
                ir,
                fidelity: None,
                losses: Vec::new(),
                notes: Vec::new(),
            })
        }
        ResolvedSource::Unrecognized => Err(BindingError::new(
            ErrorCode::UnsupportedFormat,
            Some(Phase::Decode),
            "unrecognized format: no codec in this build reads this file",
        )),
    }
}

/// Identifies the input format from the file's leading bytes.
///
/// Returns `None` when no codec in this build recognizes the bytes. A prefix
/// of [`DETECTION_PREFIX_LEN`] bytes is enough for every built-in codec.
#[must_use]
pub fn detect(input: &[u8]) -> Option<String> {
    let catalog = InputCatalog::with_builtins();
    let options = DecodeOptions::default();
    let arena = DecodeArena::new();
    let ctx = DecodeContext::new(&arena, &options.policy, options.depth);
    let prefix = &input[..input.len().min(DETECTION_PREFIX_LEN)];
    let mut source = Cursor::new(input);
    match catalog.resolve_seekable_source(&ctx, View::over_retained(prefix), &mut source, None) {
        Ok(ResolvedSource::Native { codec, .. }) => Some(codec.id().as_str().to_owned()),
        Ok(ResolvedSource::Cadir) => Some(String::from("cadir")),
        Ok(ResolvedSource::Unrecognized) | Err(_) => None,
    }
}

/// Converts one file to the format `to` names.
///
/// `to` is an output format id, optionally followed by a dialect:
/// `step` or `step:ap242`. The decode runs under cadmpeg's default
/// `DecodePolicy` at the depth the encoder needs, as `cadmpeg convert` does.
/// Losses never fail the conversion; they are returned in the report.
///
/// # Errors
///
/// Returns a [`BindingError`] whose [`ErrorCode`] says why the conversion
/// failed: an unknown format, malformed options, a decode or export failure,
/// a refusal, or a resource limit.
pub fn convert(input: &[u8], to: &str) -> Result<Conversion, BindingError> {
    let (format, dialect) = select_output(to)?;
    let encoder = build_encoder(format);
    let options = DecodeOptions {
        depth: encoder.needs().request(),
        ..DecodeOptions::default()
    };
    let decoded = decode(input, &options)?;
    let request = dialect.map_or(TargetRequest::Inherit, TargetRequest::Explicit);
    let plan = encoder
        .plan(
            EncodeInput::new(&decoded.ir, decoded.fidelity.as_ref()),
            request,
        )
        .map_err(|error| codec_error(&error, Phase::Export))?;
    let mut bytes = Vec::new();
    let export = plan
        .write_to(&mut bytes)
        .map_err(|error| codec_error(&error, Phase::Export))?;
    let losses = decoded
        .losses
        .into_iter()
        .map(|note| Loss {
            phase: Phase::Decode,
            note,
        })
        .chain(export.losses.into_iter().map(|note| Loss {
            phase: Phase::Export,
            note,
        }))
        .collect();
    let notes = decoded.notes.into_iter().chain(export.notes).collect();
    Ok(Conversion {
        bytes,
        report: Report {
            from: decoded.from,
            to: format.name().as_str().to_owned(),
            losses,
            notes,
        },
    })
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests;
