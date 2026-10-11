//! Public compile-time contracts for ORES Stack user modules.
//!
//! User code depends on these Rust types rather than hand-authored deployment
//! metadata. Runtime adapters project the same static contract into the
//! serializable admission model owned by `ores-stack-lib-core`.

pub mod sdk;

pub const MODULE_SEMANTICS_V2: &str = "ores-stack.module-semantics/v2";
pub const MODULE_SEMANTICS_V3: &str = "ores-stack.module-semantics/v3";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ModuleKind {
    Lambda,
    Http,
    Rpc,
    Page,
    Middleware,
    Worker,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum InvocationMode {
    /// One input produces one logical output.
    RequestResponse,
    /// One invocation may yield multiple ordered outputs. `WIRE.response`
    /// describes one emitted item/chunk, not a buffered aggregate response.
    Stream,
    /// Fire-and-observe event handling; retries are runtime policy.
    Event,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ConcurrencyModel {
    /// Independent invocations may execute concurrently.
    Concurrent,
    /// At most one invocation executes for the module instance.
    Serial,
    /// Invocations are serialized by a runtime-defined affinity key.
    KeyedSerial,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CancellationModel {
    /// Runtime cancellation is propagated through the module context.
    Cooperative,
    /// Deadline expiry is the canonical cancellation boundary.
    Deadline,
}

/// Wire encoding for a typed request, unary response, or stream item.
///
/// JSON, MessagePack, and Protobuf are structured codecs and therefore require
/// a canonical schema reference in the runtime descriptor. UTF-8 and bytes are
/// representation codecs for HTML/text and arbitrary binary payloads; their
/// media type remains explicit in [`StaticPayloadContract::content_type`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum PayloadCodec {
    Json,
    Messagepack,
    Protobuf,
    Utf8,
    Bytes,
}

/// Compile-time payload metadata projected into the serializable runtime/module
/// descriptor and deterministic documentation/code-generation IR.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaticPayloadContract {
    /// Canonical TypeSpec / JSON Schema / Protobuf schema identity. Structured
    /// codecs require this to be present so client types are generated from an
    /// authority rather than inferred from a Rust implementation detail.
    pub schema_ref: Option<&'static str>,
    /// Explicit media type, for example `application/json`, `text/html`,
    /// `application/msgpack`, or `application/protobuf`.
    pub content_type: &'static str,
    pub codec: PayloadCodec,
}

/// Provider-neutral request/response wire contract for one typed module.
///
/// For [`InvocationMode::RequestResponse`], `response` describes the single
/// logical response body. For [`InvocationMode::Stream`], it describes each
/// emitted response item/chunk. Event modules do not have a response payload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaticWireContract {
    pub request: Option<StaticPayloadContract>,
    pub response: Option<StaticPayloadContract>,
}

/// Capabilities are requests, not ambient authority. Runtime admission decides
/// whether a deployment may receive each requested capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Capability {
    Clock,
    Random,
    HttpClient,
    KeyValueRead,
    KeyValueWrite,
    DatabaseRead,
    DatabaseWrite,
    QueuePublish,
    QueueConsume,
    ObjectStorageRead,
    ObjectStorageWrite,
    SecretsRead,
    Spawn,
    FilesystemRead,
    FilesystemWrite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ModulePolicy {
    pub invocation: InvocationMode,
    pub concurrency: ConcurrencyModel,
    pub cancellation: CancellationModel,
    /// Zero means the runtime default. Non-zero values are admission inputs,
    /// not a guarantee that a provider supports that exact deadline.
    pub default_timeout_ms: u64,
    /// `None` delegates the limit to the runtime/deployment profile.
    pub max_concurrency: Option<u32>,
    pub idempotent: bool,
    pub retry_safe: bool,
}

impl ModulePolicy {
    pub const REQUEST_RESPONSE: Self = Self {
        invocation: InvocationMode::RequestResponse,
        concurrency: ConcurrencyModel::Concurrent,
        cancellation: CancellationModel::Deadline,
        default_timeout_ms: 0,
        max_concurrency: None,
        idempotent: false,
        retry_safe: false,
    };

    pub const EVENT: Self = Self {
        invocation: InvocationMode::Event,
        concurrency: ConcurrencyModel::Concurrent,
        cancellation: CancellationModel::Cooperative,
        default_timeout_ms: 0,
        max_concurrency: None,
        idempotent: false,
        retry_safe: false,
    };
}

/// Type-level marker used by [`TypedModule`] so a module's semantic kind is
/// part of its compile-time interface rather than an unchecked string.
pub trait ModuleKindMarker: Send + Sync + 'static {
    const KIND: ModuleKind;
    const INTERFACE: &'static str;
}

macro_rules! module_kind_marker {
    ($name:ident, $kind:ident, $interface:literal) => {
        #[derive(Debug, Clone, Copy, Default)]
        pub struct $name;

        impl ModuleKindMarker for $name {
            const KIND: ModuleKind = ModuleKind::$kind;
            const INTERFACE: &'static str = $interface;
        }
    };
}

module_kind_marker!(Lambda, Lambda, "ores-stack.lambda.v1");
module_kind_marker!(Http, Http, "ores-stack.http.v1");
module_kind_marker!(Rpc, Rpc, "ores-stack.rpc.v1");
module_kind_marker!(Page, Page, "ores-stack.page.v1");
module_kind_marker!(Middleware, Middleware, "ores-stack.middleware.v1");
module_kind_marker!(Worker, Worker, "ores-stack.worker.v1");

/// Canonical typed interface for user-exported modules.
///
/// `Input`, `Output`, `Error`, and `Context` deliberately remain generic so a
/// lambda, RPC dispatcher, page renderer, middleware component, or worker can
/// use its natural domain types while still exposing one statically checkable
/// module boundary.
#[allow(async_fn_in_trait)]
pub trait TypedModule: Send + Sync + 'static {
    type Kind: ModuleKindMarker;
    type Input: Send;
    type Output: Send;
    type Error: Send;
    type Context: Send + Sync;

    const NAME: &'static str;
    const POLICY: ModulePolicy = ModulePolicy::REQUEST_RESPONSE;
    const CAPABILITIES: &'static [Capability] = &[];
    /// Optional v3 wire contract. Generated/scaffolded modules should set this
    /// whenever the request or response is externally callable/documentable.
    /// The runtime projection upgrades such modules to semantics v3.
    const WIRE: Option<StaticWireContract> = None;

    async fn handle(
        &self,
        context: &Self::Context,
        input: Self::Input,
    ) -> Result<Self::Output, Self::Error>;
}

/// Zero-cost compile-time assertion for generated/scaffolded entrypoints.
pub const fn assert_module<T: TypedModule>() {}

/// Static projection consumed by scaffolding/runtime adapters. The internal
/// core owns serialization and environment/provider admission.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaticModuleDescriptor {
    pub semantics_version: &'static str,
    pub kind: ModuleKind,
    pub name: &'static str,
    pub interface: &'static str,
    pub policy: ModulePolicy,
    pub capabilities: &'static [Capability],
    pub wire: Option<StaticWireContract>,
}

pub const fn static_descriptor<T: TypedModule>() -> StaticModuleDescriptor {
    StaticModuleDescriptor {
        semantics_version: if T::WIRE.is_some() {
            MODULE_SEMANTICS_V3
        } else {
            MODULE_SEMANTICS_V2
        },
        kind: <T::Kind as ModuleKindMarker>::KIND,
        name: T::NAME,
        interface: <T::Kind as ModuleKindMarker>::INTERFACE,
        policy: T::POLICY,
        capabilities: T::CAPABILITIES,
        wire: T::WIRE,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Hello;

    impl TypedModule for Hello {
        type Kind = Lambda;
        type Input = String;
        type Output = String;
        type Error = ();
        type Context = ();

        const NAME: &'static str = "hello";
        const POLICY: ModulePolicy = ModulePolicy {
            invocation: InvocationMode::RequestResponse,
            concurrency: ConcurrencyModel::Concurrent,
            cancellation: CancellationModel::Deadline,
            default_timeout_ms: 5_000,
            max_concurrency: Some(64),
            idempotent: true,
            retry_safe: true,
        };
        const CAPABILITIES: &'static [Capability] = &[Capability::Clock, Capability::DatabaseRead];
        const WIRE: Option<StaticWireContract> = Some(StaticWireContract {
            request: Some(StaticPayloadContract {
                schema_ref: Some("#/schemas/hello_request"),
                content_type: "application/json",
                codec: PayloadCodec::Json,
            }),
            response: Some(StaticPayloadContract {
                schema_ref: Some("#/schemas/hello_response"),
                content_type: "application/json",
                codec: PayloadCodec::Json,
            }),
        });

        async fn handle(
            &self,
            _context: &Self::Context,
            input: Self::Input,
        ) -> Result<Self::Output, Self::Error> {
            Ok(input)
        }
    }

    struct Legacy;

    impl TypedModule for Legacy {
        type Kind = Rpc;
        type Input = String;
        type Output = String;
        type Error = ();
        type Context = ();

        const NAME: &'static str = "legacy";

        async fn handle(
            &self,
            _context: &Self::Context,
            input: Self::Input,
        ) -> Result<Self::Output, Self::Error> {
            Ok(input)
        }
    }

    #[test]
    fn static_projection_includes_runtime_semantics_and_wire_contract() {
        assert_module::<Hello>();
        let descriptor = static_descriptor::<Hello>();
        assert_eq!(descriptor.kind, ModuleKind::Lambda);
        assert_eq!(descriptor.interface, "ores-stack.lambda.v1");
        assert_eq!(descriptor.semantics_version, MODULE_SEMANTICS_V3);
        assert_eq!(descriptor.policy.default_timeout_ms, 5_000);
        assert_eq!(descriptor.policy.max_concurrency, Some(64));
        assert_eq!(descriptor.capabilities.len(), 2);
        let wire = descriptor.wire.expect("wire contract");
        assert_eq!(wire.response.expect("response").codec, PayloadCodec::Json);
    }

    #[test]
    fn modules_without_wire_metadata_retain_v2_projection() {
        let descriptor = static_descriptor::<Legacy>();
        assert_eq!(descriptor.semantics_version, MODULE_SEMANTICS_V2);
        assert_eq!(descriptor.wire, None);
    }
}
