//! Public typed SDK contract for invoking ORES Stack without shelling out to the CLI.
//!
//! This crate owns the user-facing Rust projection and SDK boundary. The
//! language-neutral semantic authority lives in `ores-stack-interfaces`.
//! Runtime execution remains the responsibility of `ores-stack-lib-core` (or
//! another conforming backend), so callers get compile-time checked calls
//! without depending on CLI argument parsing or process spawning.

#![allow(clippy::needless_return)]

use std::path::{Path, PathBuf};

pub const STACK_SDK_SCHEMA_VERSION: &str = "ores.stack.sdk/v1";
pub const STACK_SDK_AUTHORITY_REPOSITORY: &str = "ores-stack/ores-stack-interfaces";
pub const STACK_SDK_AUTHORITY_REVISION: &str = "e24f1e516186a9f68bf0f938f41e445f2a1cb4b9";

/// Stable language-neutral target identity from the Stack SDK v1 interface
/// authority. These spellings are suitable for deterministic docs, telemetry,
/// generated adapters, and cross-language conformance evidence.
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
pub enum StackDevTargetKind {
    GeneratedInfra,
    Repository,
}

impl StackDevTargetKind {
    pub const fn as_str(self) -> &'static str {
        return match self {
            Self::GeneratedInfra => "generated_infra",
            Self::Repository => "repository",
        };
    }
}

/// Typed target for `ores-stack dev`.
///
/// Keeping generated-infra and ordinary repository development distinct avoids
/// smuggling the CLI's path-shape inference into SDK callers. The backend may
/// still share implementation after target admission.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StackDevTarget {
    GeneratedInfra { root: PathBuf },
    Repository { root: PathBuf },
}

impl StackDevTarget {
    pub fn generated_infra(root: impl Into<PathBuf>) -> Self {
        return Self::GeneratedInfra { root: root.into() };
    }

    pub fn repository(root: impl Into<PathBuf>) -> Self {
        return Self::Repository { root: root.into() };
    }

    pub const fn kind(&self) -> StackDevTargetKind {
        return match self {
            Self::GeneratedInfra { .. } => StackDevTargetKind::GeneratedInfra,
            Self::Repository { .. } => StackDevTargetKind::Repository,
        };
    }

    pub fn root(&self) -> &Path {
        return match self {
            Self::GeneratedInfra { root } | Self::Repository { root } => root.as_path(),
        };
    }
}

/// Typed options for the first public ORES Stack SDK operation.
///
/// Construction does not imply runtime admission. The conforming runtime is
/// responsible for enforcing portable path bounds plus any stricter trusted
/// root, symlink, permissions, or generated-authority policy.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct StackDevOptions {
    pub target: StackDevTarget,
}

impl StackDevOptions {
    pub fn generated_infra(root: impl Into<PathBuf>) -> Self {
        return Self {
            target: StackDevTarget::generated_infra(root),
        };
    }

    pub fn repository(root: impl Into<PathBuf>) -> Self {
        return Self {
            target: StackDevTarget::repository(root),
        };
    }
}

/// Runtime authority behind the public SDK.
///
/// `ores-stack-lib-core` should implement this trait and the CLI should delegate
/// to that same implementation. The public crate intentionally does not spawn
/// `ores-stack` or `ores-compose`; process-free typed composition is the
/// dependency-direction invariant.
pub trait StackSdkBackend {
    type Error;

    fn dev(&self, options: StackDevOptions) -> Result<(), Self::Error>;
}

/// Public typed ORES Stack SDK facade.
///
/// The generic backend keeps this crate publishable and provider-neutral while
/// still giving callers a concrete, compile-time checked API. Production code
/// should construct this with the backend exported by `ores-stack-lib-core`.
#[derive(Debug)]
pub struct StackSdk<B> {
    backend: B,
}

impl<B> StackSdk<B> {
    pub const fn new(backend: B) -> Self {
        return Self { backend };
    }

    pub const fn backend(&self) -> &B {
        return &self.backend;
    }

    pub fn into_backend(self) -> B {
        return self.backend;
    }
}

impl<B> StackSdk<B>
where
    B: StackSdkBackend,
{
    pub fn dev(&self, options: StackDevOptions) -> Result<(), B::Error> {
        return self.backend.dev(options);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Debug, Default)]
    struct RecordingBackend {
        calls: RefCell<Vec<StackDevOptions>>,
    }

    impl StackSdkBackend for RecordingBackend {
        type Error = &'static str;

        fn dev(&self, options: StackDevOptions) -> Result<(), Self::Error> {
            self.calls.borrow_mut().push(options);
            return Ok(());
        }
    }

    #[test]
    fn generated_infra_target_is_explicit_and_typed() {
        let options = StackDevOptions::generated_infra("alpha-infra");
        assert_eq!(options.target.root(), Path::new("alpha-infra"));
        assert_eq!(options.target.kind(), StackDevTargetKind::GeneratedInfra);
        assert_eq!(options.target.kind().as_str(), "generated_infra");
    }

    #[test]
    fn repository_target_preserves_interface_authority_spelling() {
        let options = StackDevOptions::repository("service-api");
        assert_eq!(options.target.kind(), StackDevTargetKind::Repository);
        assert_eq!(options.target.kind().as_str(), "repository");
        assert_eq!(STACK_SDK_SCHEMA_VERSION, "ores.stack.sdk/v1");
        assert_eq!(
            STACK_SDK_AUTHORITY_REVISION,
            "e24f1e516186a9f68bf0f938f41e445f2a1cb4b9"
        );
    }

    #[test]
    fn sdk_delegates_without_cli_argument_or_process_boundary() {
        let sdk = StackSdk::new(RecordingBackend::default());
        let options = StackDevOptions::repository("service-api");

        sdk.dev(options.clone()).expect("typed dev call");

        let calls = sdk.backend().calls.borrow();
        assert_eq!(calls.as_slice(), &[options]);
    }
}
