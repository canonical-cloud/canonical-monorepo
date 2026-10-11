use ores_stack_lib_core::{
    Capability, InvocationMode, ModuleDescriptor, ModuleKind, PayloadCodec, MODULE_CONTRACT_V1,
    MODULE_SEMANTICS_V2, MODULE_SEMANTICS_V3,
};
use serde_json::Value;

const JSON_SCHEMA: &str = include_str!("../contracts/module-descriptor.schema.json");
const TYPESPEC: &str = include_str!("../contracts/module-descriptor.tsp");
const V2_FIXTURE: &str = include_str!("../contracts/fixtures/module-descriptor.v2.json");
const V3_FIXTURE: &str = include_str!("../contracts/fixtures/module-descriptor.v3.json");

#[test]
fn retained_v2_fixture_deserializes_and_passes_rust_admission_validation() {
    let descriptor: ModuleDescriptor = serde_json::from_str(V2_FIXTURE).expect("fixture JSON");
    descriptor.validate().expect("fixture semantic validation");

    assert_eq!(descriptor.contract_version, MODULE_CONTRACT_V1);
    assert_eq!(
        descriptor.semantics_version.as_deref(),
        Some(MODULE_SEMANTICS_V2)
    );
    assert_eq!(descriptor.kind, ModuleKind::Rpc);
    assert_eq!(
        descriptor.capabilities,
        vec![Capability::Clock, Capability::DatabaseRead]
    );
    assert!(descriptor.wire.is_none());
}

#[test]
fn retained_v3_fixture_carries_typed_stream_item_contract() {
    let descriptor: ModuleDescriptor = serde_json::from_str(V3_FIXTURE).expect("fixture JSON");
    descriptor.validate().expect("fixture semantic validation");

    assert_eq!(
        descriptor.semantics_version.as_deref(),
        Some(MODULE_SEMANTICS_V3)
    );
    assert_eq!(descriptor.kind, ModuleKind::Lambda);
    assert_eq!(descriptor.policy.invocation, InvocationMode::Stream);
    let response = descriptor
        .wire
        .as_ref()
        .and_then(|wire| wire.response.as_ref())
        .expect("stream item response contract");
    assert_eq!(response.codec, PayloadCodec::Messagepack);
    assert_eq!(
        response.schema_ref.as_deref(),
        Some("#/schemas/event_chunk")
    );
}

#[test]
fn json_schema_declares_draft_2020_12_and_canonical_versions() {
    let schema: Value = serde_json::from_str(JSON_SCHEMA).expect("authored JSON Schema");
    assert_eq!(
        schema.get("$schema").and_then(Value::as_str),
        Some("https://json-schema.org/draft/2020-12/schema")
    );
    assert!(JSON_SCHEMA.contains(MODULE_CONTRACT_V1));
    assert!(JSON_SCHEMA.contains(MODULE_SEMANTICS_V2));
    assert!(JSON_SCHEMA.contains(MODULE_SEMANTICS_V3));
}

#[test]
fn authored_typespec_and_json_schema_cover_the_rust_wire_vocabulary() {
    for wire_name in [
        "lambda",
        "http",
        "rpc",
        "page",
        "middleware",
        "worker",
        "request_response",
        "stream",
        "event",
        "concurrent",
        "serial",
        "keyed_serial",
        "cooperative",
        "deadline",
        "json",
        "messagepack",
        "protobuf",
        "utf8",
        "bytes",
        "schema_ref",
        "content_type",
        "clock",
        "random",
        "http_client",
        "key_value_read",
        "key_value_write",
        "database_read",
        "database_write",
        "queue_publish",
        "queue_consume",
        "object_storage_read",
        "object_storage_write",
        "secrets_read",
        "spawn",
        "filesystem_read",
        "filesystem_write",
    ] {
        assert!(
            JSON_SCHEMA.contains(wire_name),
            "JSON Schema missing {wire_name}"
        );
        assert!(TYPESPEC.contains(wire_name), "TypeSpec missing {wire_name}");
    }
}

#[test]
fn kind_interface_pairs_remain_explicit_in_both_authored_authorities() {
    for (kind, interface) in [
        ("lambda", "ores-stack.lambda.v1"),
        ("http", "ores-stack.http.v1"),
        ("rpc", "ores-stack.rpc.v1"),
        ("page", "ores-stack.page.v1"),
        ("middleware", "ores-stack.middleware.v1"),
        ("worker", "ores-stack.worker.v1"),
    ] {
        assert!(JSON_SCHEMA.contains(kind));
        assert!(JSON_SCHEMA.contains(interface));
        assert!(TYPESPEC.contains(&format!("kind: \"{kind}\";")));
        assert!(TYPESPEC.contains(&format!("interface: \"{interface}\";")));
    }
}
