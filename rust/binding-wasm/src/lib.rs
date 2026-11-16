// SPDX-License-Identifier: Apache-2.0
//! wasm-bindgen shell over `cadmpeg-binding`.
//!
//! Each format module is this crate built with that format's codec features.
//! Failures cross as a JSON string the TypeScript layer turns into a
//! `CadmpegError`; a panic aborts the instance, and the TypeScript layer
//! discards it.

#![allow(
    clippy::must_use_candidate,
    reason = "every export is called from JavaScript, which never sees `#[must_use]`"
)]

use wasm_bindgen::prelude::*;

/// A completed conversion: the written bytes and the report as JSON.
#[wasm_bindgen]
pub struct Conversion {
    bytes: Vec<u8>,
    report: String,
}

#[wasm_bindgen]
impl Conversion {
    /// Moves the written file out of the result.
    #[wasm_bindgen(js_name = takeBytes)]
    pub fn take_bytes(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.bytes)
    }

    /// The conversion report as a JSON string.
    #[wasm_bindgen(getter)]
    pub fn report(&self) -> String {
        self.report.clone()
    }
}

/// The formats this module reads and writes, as JSON.
#[wasm_bindgen]
pub fn capabilities() -> String {
    serde_json::to_string(&cadmpeg_binding::capabilities()).unwrap_or_default()
}

/// The input format id this module recognizes in `input`, if any.
#[wasm_bindgen]
pub fn detect(input: &[u8]) -> Option<String> {
    cadmpeg_binding::detect(input)
}

/// Converts `input` to the format `to` names.
///
/// # Errors
///
/// Throws the binding error as a JSON string.
#[wasm_bindgen]
pub fn convert(input: &[u8], to: &str) -> Result<Conversion, JsValue> {
    let conversion =
        cadmpeg_binding::convert(input, to).map_err(|error| JsValue::from_str(&error.to_json()))?;
    let report = serde_json::to_string(&conversion.report)
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
    Ok(Conversion {
        bytes: conversion.bytes,
        report,
    })
}
