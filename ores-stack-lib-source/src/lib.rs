pub mod framework_ai;
pub mod lifecycle;
pub mod runtime_binding;
pub mod sdk;
pub mod server;
pub mod startup;
pub mod wire;

pub use framework_ai::{
    Authority, EvidenceChunk, FrameworkAiAnswer, FrameworkAiClient, FrameworkAiError,
    FrameworkAiPolicy, FrameworkAiQuery, ReleaseRef,
};
pub use runtime_binding::{
    ActorBackend, ExecutionModel, RuntimeBinding, RuntimeBindingError, RuntimeTransport,
    RUNTIME_BINDING_V1,
};
pub use wire::{
    ModuleWireContract, PayloadCodec, PayloadContract, StaticPayloadContract, StaticWireContract,
    WireContractError,
};

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use thiserror::Error;

pub const MODULE_CONTRACT_V1: &str = "ores-stack-module-contract-v1";
pub const MODULE_SEMANTICS_V2: &str = "ores-stack.module-semantics/v2";
pub const MODULE_SEMANTICS_V3: &str = "ores-stack.module-semantics/v3";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ModuleKind {
    Lambda,
    Http,
    Rpc,
    Page,
    Middleware,
    Worker,
}

impl ModuleKind {
    pub const fn interface(self) -> &'static str {
        match self {
            Self::Lambda => "ores-stack.lambda.v1",
            Self::Http => "ores-stack.http.v1",
            Self::Rpc => "ores-stack.rpc.v1",
            Self::Page => "ores-stack.page.v1",
            Self::Middleware => "ores-stack.middleware.v1",
            Self::Worker => "ores-stack.worker.v1",
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum InvocationMode {
    RequestResponse,
    Stream,
    Event,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ConcurrencyModel {
    Concurrent,
    Serial,
    KeyedSerial,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum CancellationModel {
    Cooperative,
    Deadline,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModulePolicy {
    pub invocation: InvocationMode,
    pub concurrency: ConcurrencyModel,
    pub cancellation: CancellationModel,
    pub default_timeout_ms: u64,
    pub max_concurrency: Option<u32>,
    pub idempotent: bool,
    pub retry_safe: bool,
}

impl Default for ModulePolicy {
    fn default() -> Self {
        Self {
            invocation: InvocationMode::RequestResponse,
            concurrency: ConcurrencyModel::Concurrent,
            cancellation: CancellationModel::Deadline,
            default_timeout_ms: 0,
            max_concurrency: None,
            idempotent: false,
            retry_safe: false,
        }
    }
}

/// Runtime/build projection of a statically typed module export.
///
/// `capabilities` are requested authority. Deployment admission chooses the
/// actual authority granted to the module.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModuleDescriptor {
    pub contract_version: String,
    #[serde(default)]
    pub semantics_version: Option<String>,
    pub kind: ModuleKind,
    pub name: String,
    pub interface: String,
    pub entrypoint: String,
    #[serde(default)]
    pub policy: ModulePolicy,
    #[serde(default)]
    pub capabilities: Vec<Capability>,
    /// Optional v3 request/response representation contract. For streaming
    /// modules, `wire.response` is the item/chunk contract, while
    /// `policy.invocation` remains the sole framing authority.
    #[serde(default)]
    pub wire: Option<ModuleWireContract>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ModuleContractError {
    #[error("unsupported module contract version")]
    Version,
    #[error("unsupported module semantics version")]
    SemanticsVersion,
    #[error("wire metadata requires ores-stack.module-semantics/v3")]
    WireRequiresV3,
    #[error("module name must be a non-empty portable identifier")]
    Name,
    #[error("module interface does not match its semantic kind")]
    Interface,
    #[error("entrypoint must be non-empty and contain no whitespace")]
    Entrypoint,
    #[error("module policy is invalid")]
    Policy,
    #[error("module capability list contains duplicates")]
    DuplicateCapability,
    #[error(transparent)]
    Wire(#[from] WireContractError),
}

impl ModuleDescriptor {
    pub fn validate(&self) -> Result<(), ModuleContractError> {
        if self.contract_version != MODULE_CONTRACT_V1 {
            return Err(ModuleContractError::Version);
        }
        if self
            .semantics_version
            .as_deref()
            .is_some_and(|version| version != MODULE_SEMANTICS_V2 && version != MODULE_SEMANTICS_V3)
        {
            return Err(ModuleContractError::SemanticsVersion);
        }
        if self.wire.is_some() && self.semantics_version.as_deref() != Some(MODULE_SEMANTICS_V3) {
            return Err(ModuleContractError::WireRequiresV3);
        }
        if !portable_ident(&self.name) {
            return Err(ModuleContractError::Name);
        }
        if self.interface != self.kind.interface() {
            return Err(ModuleContractError::Interface);
        }
        if self.entrypoint.is_empty() || self.entrypoint.chars().any(char::is_whitespace) {
            return Err(ModuleContractError::Entrypoint);
        }
        if self.policy.max_concurrency == Some(0) {
            return Err(ModuleContractError::Policy);
        }
        if let Some(wire) = &self.wire {
            wire.validate(self.policy.invocation)?;
        }

        let mut unique = HashSet::with_capacity(self.capabilities.len());
        if self
            .capabilities
            .iter()
            .any(|capability| !unique.insert(*capability))
        {
            return Err(ModuleContractError::DuplicateCapability);
        }
        Ok(())
    }
}

/// Compile-time contract for server-only/internal module implementations.
///
/// Public/client-safe modules use `TypedModule` from `ores-stack-pub-lib-core`.
/// This trait intentionally lives in the internal core so server-only context,
/// input, output, and error types never have to leak into the public crate.
#[allow(async_fn_in_trait)]
pub trait InternalModule: Send + Sync + 'static {
    type Input: Send;
    type Output: Send;
    type Error: Send;
    type Context: Send + Sync;

    const KIND: ModuleKind;
    const NAME: &'static str;
    const POLICY: ModulePolicy = ModulePolicy {
        invocation: InvocationMode::RequestResponse,
        concurrency: ConcurrencyModel::Concurrent,
        cancellation: CancellationModel::Deadline,
        default_timeout_ms: 0,
        max_concurrency: None,
        idempotent: false,
        retry_safe: false,
    };
    const CAPABILITIES: &'static [Capability] = &[];
    const WIRE: Option<StaticWireContract> = None;

    async fn handle(
        &self,
        context: &Self::Context,
        input: Self::Input,
    ) -> Result<Self::Output, Self::Error>;
}

/// Zero-cost static assertion for generated/scaffolded internal entrypoints.
pub const fn assert_internal_module<T: InternalModule>() {}

/// Project an internal compile-time implementation into the same admission
/// descriptor used for public modules. Public and internal implementations can
/// therefore share provider/runtime admission without sharing Rust types.
pub fn descriptor_for_internal<T: InternalModule>(
    entrypoint: impl Into<String>,
) -> ModuleDescriptor {
    ModuleDescriptor {
        contract_version: MODULE_CONTRACT_V1.to_owned(),
        semantics_version: Some(
            if T::WIRE.is_some() {
                MODULE_SEMANTICS_V3
            } else {
                MODULE_SEMANTICS_V2
            }
            .to_owned(),
        ),
        kind: T::KIND,
        name: T::NAME.to_owned(),
        interface: T::KIND.interface().to_owned(),
        entrypoint: entrypoint.into(),
        policy: T::POLICY,
        capabilities: T::CAPABILITIES.to_vec(),
        wire: T::WIRE.map(Into::into),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdmissionProfile {
    #[serde(default)]
    pub allowed_capabilities: Vec<Capability>,
    /// Zero delegates timeout policy to a later provider/runtime layer.
    pub max_timeout_ms: u64,
    /// `None` means this profile does not impose an additional concurrency cap.
    pub max_concurrency: Option<u32>,
    pub allow_streaming: bool,
    pub allow_events: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum AdmissionError {
    #[error(transparent)]
    Contract(#[from] ModuleContractError),
    #[error("module requests capability not admitted by deployment profile: {0:?}")]
    CapabilityDenied(Capability),
    #[error("streaming invocation is not admitted by deployment profile")]
    StreamingDenied,
    #[error("event invocation is not admitted by deployment profile")]
    EventDenied,
    #[error("module timeout exceeds deployment profile")]
    TimeoutExceeded,
    #[error("module concurrency exceeds deployment profile")]
    ConcurrencyExceeded,
}

impl AdmissionProfile {
    pub fn admit(&self, descriptor: &ModuleDescriptor) -> Result<(), AdmissionError> {
        descriptor.validate()?;

        match descriptor.policy.invocation {
            InvocationMode::Stream if !self.allow_streaming => {
                return Err(AdmissionError::StreamingDenied);
            }
            InvocationMode::Event if !self.allow_events => return Err(AdmissionError::EventDenied),
            InvocationMode::RequestResponse | InvocationMode::Stream | InvocationMode::Event => {}
        }

        if self.max_timeout_ms != 0 && descriptor.policy.default_timeout_ms > self.max_timeout_ms {
            return Err(AdmissionError::TimeoutExceeded);
        }

        if let (Some(requested), Some(allowed)) =
            (descriptor.policy.max_concurrency, self.max_concurrency)
        {
            if requested > allowed {
                return Err(AdmissionError::ConcurrencyExceeded);
            }
        }

        for capability in &descriptor.capabilities {
            if !self.allowed_capabilities.contains(capability) {
                return Err(AdmissionError::CapabilityDenied(*capability));
            }
        }
        Ok(())
    }
}

fn portable_ident(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor() -> ModuleDescriptor {
        ModuleDescriptor {
            contract_version: MODULE_CONTRACT_V1.into(),
            semantics_version: Some(MODULE_SEMANTICS_V2.into()),
            kind: ModuleKind::Rpc,
            name: "catalog".into(),
            interface: "ores-stack.rpc.v1".into(),
            entrypoint: "crate::rpc::Catalog".into(),
            policy: ModulePolicy {
                invocation: InvocationMode::RequestResponse,
                concurrency: ConcurrencyModel::Concurrent,
                cancellation: CancellationModel::Deadline,
                default_timeout_ms: 5_000,
                max_concurrency: Some(32),
                idempotent: true,
                retry_safe: true,
            },
            capabilities: vec![Capability::Clock, Capability::DatabaseRead],
            wire: None,
        }
    }

    struct CatalogInternal;

    impl InternalModule for CatalogInternal {
        type Input = String;
        type Output = String;
        type Error = ();
        type Context = ();

        const KIND: ModuleKind = ModuleKind::Rpc;
        const NAME: &'static str = "catalog_internal";
        const POLICY: ModulePolicy = ModulePolicy {
            invocation: InvocationMode::RequestResponse,
            concurrency: ConcurrencyModel::Concurrent,
            cancellation: CancellationModel::Deadline,
            default_timeout_ms: 5_000,
            max_concurrency: Some(32),
            idempotent: true,
            retry_safe: true,
        };
        const CAPABILITIES: &'static [Capability] = &[Capability::Clock, Capability::DatabaseRead];
        const WIRE: Option<StaticWireContract> = Some(StaticWireContract {
            request: Some(StaticPayloadContract {
                schema_ref: Some("#/schemas/catalog_request"),
                content_type: "application/msgpack",
                codec: PayloadCodec::Messagepack,
            }),
            response: Some(StaticPayloadContract {
                schema_ref: Some("#/schemas/catalog_response"),
                content_type: "application/msgpack",
                codec: PayloadCodec::Messagepack,
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

    #[test]
    fn validates_semantic_descriptor() {
        assert_eq!(descriptor().validate(), Ok(()));
    }

    #[test]
    fn internal_module_is_statically_constrained_and_projectable() {
        assert_internal_module::<CatalogInternal>();
        let descriptor = descriptor_for_internal::<CatalogInternal>("crate::rpc::CatalogInternal");
        assert_eq!(descriptor.validate(), Ok(()));
        assert_eq!(descriptor.kind, ModuleKind::Rpc);
        assert_eq!(descriptor.interface, "ores-stack.rpc.v1");
        assert_eq!(descriptor.capabilities.len(), 2);
        assert_eq!(
            descriptor.semantics_version.as_deref(),
            Some(MODULE_SEMANTICS_V3)
        );
        assert_eq!(
            descriptor
                .wire
                .as_ref()
                .and_then(|wire| wire.response.as_ref())
                .map(|payload| payload.codec),
            Some(PayloadCodec::Messagepack)
        );
    }

    #[test]
    fn wire_contract_cannot_hide_under_v2_semantics() {
        let mut descriptor = descriptor();
        descriptor.wire = Some(ModuleWireContract {
            request: None,
            response: Some(PayloadContract {
                schema_ref: None,
                content_type: "text/html; charset=utf-8".into(),
                codec: PayloadCodec::Utf8,
            }),
        });
        assert_eq!(
            descriptor.validate(),
            Err(ModuleContractError::WireRequiresV3)
        );
    }

    #[test]
    fn rejects_duplicate_capabilities() {
        let mut descriptor = descriptor();
        descriptor.capabilities.push(Capability::Clock);
        assert_eq!(
            descriptor.validate(),
            Err(ModuleContractError::DuplicateCapability)
        );
    }

    #[test]
    fn admission_is_capability_and_budget_bounded() {
        let profile = AdmissionProfile {
            allowed_capabilities: vec![Capability::Clock, Capability::DatabaseRead],
            max_timeout_ms: 10_000,
            max_concurrency: Some(64),
            allow_streaming: false,
            allow_events: false,
        };
        assert_eq!(profile.admit(&descriptor()), Ok(()));

        let mut denied = descriptor();
        denied.capabilities.push(Capability::SecretsRead);
        assert_eq!(
            profile.admit(&denied),
            Err(AdmissionError::CapabilityDenied(Capability::SecretsRead))
        );
    }

    #[test]
    fn legacy_v1_descriptor_remains_valid_without_semantics_version() {
        let mut descriptor = descriptor();
        descriptor.semantics_version = None;
        descriptor.policy = ModulePolicy::default();
        descriptor.capabilities.clear();
        descriptor.wire = None;
        assert_eq!(descriptor.validate(), Ok(()));
    }
}
