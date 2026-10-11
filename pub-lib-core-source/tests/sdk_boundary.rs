#![allow(clippy::needless_return)]

use std::fs;
use std::path::PathBuf;

fn repository_file(path: &str) -> String {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    return fs::read_to_string(root.join(path)).expect("read repository file");
}

#[test]
fn public_sdk_does_not_depend_back_on_runtime_core() {
    let manifest = repository_file("Cargo.toml");
    let runtime_core = concat!("ores-stack-", "lib-core");
    assert!(!manifest.contains(runtime_core));
}

#[test]
fn public_sdk_has_no_process_execution_boundary() {
    let sdk = repository_file("src/sdk.rs");
    let command_new = concat!("Command", "::new");
    let std_process = concat!("std::", "process");
    let tokio_process = concat!("tokio::", "process");

    assert!(!sdk.contains(command_new));
    assert!(!sdk.contains(std_process));
    assert!(!sdk.contains(tokio_process));
}
