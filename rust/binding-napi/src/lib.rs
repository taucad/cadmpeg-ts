// SPDX-License-Identifier: Apache-2.0
//! napi-rs shell over `cadmpeg-binding`, carrying every codec.
//!
//! `convert` runs as an `AsyncTask` on the libuv thread pool, so a long
//! decode never blocks Node's event loop. napi-rs contains a panic in the
//! task and rejects the promise, and the TypeScript layer reports it as
//! `ENGINE_FAILED`. Binding failures reject with the error as JSON in the
//! message, which the TypeScript layer turns into a `CadmpegError`.

use napi::bindgen_prelude::*;
use napi_derive::napi;

/// A completed conversion: the written bytes and the report as JSON.
#[napi(object)]
pub struct Conversion {
    /// The written file.
    pub bytes: Buffer,
    /// The conversion report as a JSON string.
    pub report: String,
}

/// The formats this addon reads and writes, as JSON.
#[napi]
pub fn capabilities() -> String {
    serde_json::to_string(&cadmpeg_binding::capabilities()).unwrap_or_default()
}

/// The input format id recognized in `input`, if any.
#[napi]
#[allow(clippy::needless_pass_by_value)]
pub fn detect(input: Buffer) -> Option<String> {
    cadmpeg_binding::detect(&input)
}

/// The conversion task run on the libuv pool.
pub struct ConvertTask {
    input: Buffer,
    to: String,
}

impl Task for ConvertTask {
    type Output = cadmpeg_binding::Conversion;
    type JsValue = Conversion;

    fn compute(&mut self) -> Result<Self::Output> {
        cadmpeg_binding::convert(&self.input, &self.to)
            .map_err(|error| Error::from_reason(error.to_json()))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue> {
        let report = serde_json::to_string(&output.report)
            .map_err(|error| Error::from_reason(error.to_string()))?;
        Ok(Conversion {
            bytes: output.bytes.into(),
            report,
        })
    }
}

/// Converts `input` to the format `to` names, off the main thread.
#[napi(ts_return_type = "Promise<Conversion>")]
pub fn convert(input: Buffer, to: String) -> AsyncTask<ConvertTask> {
    AsyncTask::new(ConvertTask { input, to })
}
