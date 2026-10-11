#![allow(clippy::needless_return)]

use ores_stack_lib_core::sdk::{StackDevExecutor, StackRuntimeBackend};
use ores_stack_pub_lib_core::sdk::{StackDevOptions, StackSdk, STACK_SDK_SCHEMA_VERSION};
use serde::Deserialize;
use serde_json::{Map, Value};
use std::convert::Infallible;
use std::fs;
use std::path::Path;

#[derive(Debug, Deserialize)]
struct Corpus {
    version: String,
    schema_version: String,
    cases: Vec<Case>,
}

#[derive(Debug, Deserialize)]
struct Case {
    id: String,
    valid: bool,
    options: Value,
}

#[derive(Debug, Default)]
struct NoopExecutor;

impl StackDevExecutor for NoopExecutor {
    type Error = Infallible;

    fn dev_generated_infra(&self, _root: &Path) -> Result<(), Self::Error> {
        return Ok(());
    }

    fn dev_repository(&self, _root: &Path) -> Result<(), Self::Error> {
        return Ok(());
    }
}

fn exact_keys(object: &Map<String, Value>, expected: &[&str]) -> bool {
    if object.len() != expected.len() {
        return false;
    }
    return expected.iter().all(|key| object.contains_key(*key));
}

#[test]
fn shared_stack_sdk_conformance_corpus_matches_runtime_admission() {
    let Some(path) = std::env::var_os("ORES_STACK_SDK_CONFORMANCE") else {
        eprintln!("shared Stack SDK conformance corpus not configured; skipping cross-repo proof");
        return;
    };

    let bytes = fs::read(&path).expect("read shared Stack SDK conformance corpus");
    let corpus: Corpus = serde_json::from_slice(&bytes).expect("parse shared Stack SDK corpus");
    assert_eq!(corpus.version, "ores.stack.sdk.conformance/v1");
    assert_eq!(corpus.schema_version, STACK_SDK_SCHEMA_VERSION);
    assert!(!corpus.cases.is_empty());

    for case in corpus.cases {
        let Some(options) = case.options.as_object() else {
            assert!(
                !case.valid,
                "{}: non-object options must be invalid",
                case.id
            );
            continue;
        };
        if !exact_keys(options, &["target"]) {
            assert!(!case.valid, "{}: unknown options fields must fail", case.id);
            continue;
        }

        let Some(target) = options.get("target").and_then(Value::as_object) else {
            assert!(!case.valid, "{}: missing target must fail", case.id);
            continue;
        };
        if !exact_keys(target, &["kind", "root"]) {
            assert!(!case.valid, "{}: unknown target fields must fail", case.id);
            continue;
        }

        let Some(kind) = target.get("kind").and_then(Value::as_str) else {
            assert!(!case.valid, "{}: non-string target kind must fail", case.id);
            continue;
        };
        let Some(root) = target.get("root").and_then(Value::as_str) else {
            assert!(!case.valid, "{}: non-string root must fail", case.id);
            continue;
        };

        let options = match kind {
            "generated_infra" => StackDevOptions::generated_infra(root),
            "repository" => StackDevOptions::repository(root),
            _ => {
                assert!(!case.valid, "{}: unknown target kind must fail", case.id);
                continue;
            }
        };

        let sdk = StackSdk::new(StackRuntimeBackend::new(NoopExecutor));
        let admitted = sdk.dev(options).is_ok();
        assert_eq!(admitted, case.valid, "{}", case.id);
    }
}
