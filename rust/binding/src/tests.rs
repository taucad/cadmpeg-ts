// SPDX-License-Identifier: Apache-2.0
use super::{capabilities, convert, detect, ErrorCode, Phase};

const CORPUS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../upstream/cadmpeg/corpus/");

fn corpus(path: &str) -> Vec<u8> {
    std::fs::read(format!("{CORPUS}{path}")).expect("corpus file")
}

/// One native file per readable codec the upstream corpus carries.
const NATIVE: &[(&str, &str)] = &[
    ("nist-pmi/step/nist_ctc_01_asme1_ap242-e1.stp", "step"),
    ("nist-pmi/sldprt/nist_ftc_06_asme1_rd_sw1802.SLDPRT", "sldprt"),
    ("nist-pmi/catia/nist_ftc_07_asme1_rd_ct5290_ra.CATPart", "catia"),
    ("nist-pmi/nx/nist_ctc_03_asme1_nx1980_rc.prt", "nx"),
    ("nist-pmi/creo/nist_ctc_01_asme1_rd_cr10030.prt.5", "creo"),
    ("nist-pmi/inventor/INV_nist_ctc_01_asme1_2021.ipt", "inventor"),
    ("freecad_fcstd/fixtures/named_constraint_1.0.2_P12a.FCStd", "fcstd"),
    ("1WireRGBWController.f3d", "f3d"),
];

#[test]
fn capabilities_list_every_codec_and_writer() {
    let capabilities = capabilities();
    assert_eq!(capabilities.engine, super::ENGINE_VERSION);
    let inputs: Vec<&str> = capabilities.inputs.iter().map(|f| f.id.as_str()).collect();
    for id in ["step", "sldprt", "catia", "nx", "creo", "inventor", "fcstd", "f3d", "iges", "rhino"] {
        assert!(inputs.contains(&id), "missing input {id}: {inputs:?}");
    }
    assert!(capabilities.inputs.iter().all(|f| !f.extensions.is_empty()));
    let outputs: Vec<&str> = capabilities.outputs.iter().map(|f| f.id.as_str()).collect();
    for id in ["cadir", "step", "iges", "fcstd", "f3d", "sldprt", "rhino", "usd"] {
        assert!(outputs.contains(&id), "missing output {id}: {outputs:?}");
    }
}

#[test]
fn detects_every_corpus_format() {
    for (path, id) in NATIVE {
        assert_eq!(detect(&corpus(path)).as_deref(), Some(*id), "{path}");
    }
    assert_eq!(detect(b"not a cad file"), None);
}

#[test]
fn converts_every_corpus_format_to_step_deterministically() {
    for (path, id) in NATIVE {
        let input = corpus(path);
        let first = convert(&input, "step").unwrap_or_else(|e| panic!("{path}: {e}"));
        assert_eq!(first.report.from, *id);
        assert_eq!(first.report.to, "step");
        assert!(first.bytes.starts_with(b"ISO-10303-21;"), "{path}");
        let second = convert(&input, "step").expect("second conversion");
        assert_eq!(first.bytes, second.bytes, "{path} is not deterministic");
        assert_eq!(first.report, second.report);
    }
}

#[test]
fn writes_every_native_writer_from_step() {
    let input = corpus("nist-pmi/step/nist_ctc_01_asme1_ap242-e1.stp");
    for to in ["iges", "fcstd", "f3d", "sldprt", "rhino", "usd", "cadir"] {
        let conversion = convert(&input, to).unwrap_or_else(|e| panic!("{to}: {e}"));
        assert!(!conversion.bytes.is_empty(), "{to}");
        assert_eq!(conversion.report.to, to);
    }
}

#[test]
fn reads_cadir_back() {
    let input = corpus("nist-pmi/step/nist_ctc_01_asme1_ap242-e1.stp");
    let cadir = convert(&input, "cadir").expect("cadir");
    let step = convert(&cadir.bytes, "step").expect("step from cadir");
    assert_eq!(step.report.from, "cadir");
    assert!(step.bytes.starts_with(b"ISO-10303-21;"));
}

#[test]
fn reports_losses_with_their_phase() {
    let input = corpus("nist-pmi/sldprt/nist_ftc_06_asme1_rd_sw1802.SLDPRT");
    let conversion = convert(&input, "step").expect("conversion");
    let json = serde_json::to_value(&conversion.report).expect("report json");
    for loss in json["losses"].as_array().expect("losses") {
        assert!(matches!(loss["phase"].as_str(), Some("decode" | "export")));
        assert!(loss["code"].is_string());
        assert!(loss["message"].is_string());
    }
}

#[test]
fn accepts_an_explicit_dialect() {
    let input = corpus("nist-pmi/step/nist_ctc_01_asme1_ap242-e1.stp");
    let conversion = convert(&input, "step:ap214").expect("ap214");
    assert!(conversion.bytes.starts_with(b"ISO-10303-21;"));
}

#[test]
fn refuses_with_stable_codes() {
    let step = corpus("nist-pmi/step/nist_ctc_01_asme1_ap242-e1.stp");
    let unknown_output = convert(&step, "obj").expect_err("obj");
    assert_eq!(unknown_output.code, ErrorCode::UnsupportedFormat);
    assert_eq!(unknown_output.phase, Some(Phase::Export));

    let empty_dialect = convert(&step, "step:").expect_err("empty dialect");
    assert_eq!(empty_dialect.code, ErrorCode::InvalidOptions);

    let unknown_dialect = convert(&step, "step:ap999").expect_err("dialect");
    assert_eq!(unknown_dialect.code, ErrorCode::Refused);

    let unrecognized = convert(b"not a cad file", "step").expect_err("unrecognized");
    assert_eq!(unrecognized.code, ErrorCode::UnsupportedFormat);
    assert_eq!(unrecognized.phase, Some(Phase::Decode));

    let json: serde_json::Value = serde_json::from_str(&unrecognized.to_json()).expect("json");
    assert_eq!(json["code"], "UNSUPPORTED_FORMAT");
    assert_eq!(json["phase"], "decode");
}

#[test]
fn truncated_native_input_fails_to_import() {
    let input = corpus("nist-pmi/sldprt/nist_ftc_06_asme1_rd_sw1802.SLDPRT");
    let error = convert(&input[..input.len() / 3], "step").expect_err("truncated");
    assert!(
        matches!(error.code, ErrorCode::ImportFailed | ErrorCode::UnsupportedFormat),
        "{error:?}"
    );
}
