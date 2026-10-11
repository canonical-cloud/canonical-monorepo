//! Runtime implementation boundary for the public `ores-stack` SDK.
//!
//! The public request types live in `ores-stack-pub-lib-core`. This module
//! performs runtime-side target admission and dispatches to an injected runtime
//! executor without parsing CLI arguments or spawning the `ores-stack` or
//! `ores-compose` executables.

#![allow(clippy::needless_return)]

use ores_stack_pub_lib_core::sdk::{StackDevOptions, StackDevTarget, StackSdkBackend};
use std::fmt;
use std::path::{Path, PathBuf};

pub const MAX_STACK_DEV_ROOT_CHARS: usize = 4096;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdmittedStackDevTarget {
    GeneratedInfra { root: PathBuf },
    Repository { root: PathBuf },
}

impl AdmittedStackDevTarget {
    pub fn root(&self) -> &Path {
        return match self {
            Self::GeneratedInfra { root } | Self::Repository { root } => root.as_path(),
        };
    }
}

pub trait StackDevExecutor {
    type Error;

    fn dev_generated_infra(&self, root: &Path) -> Result<(), Self::Error>;
    fn dev_repository(&self, root: &Path) -> Result<(), Self::Error>;
}

#[derive(Debug)]
pub struct StackRuntimeBackend<E> {
    executor: E,
}

impl<E> StackRuntimeBackend<E> {
    pub const fn new(executor: E) -> Self {
        return Self { executor };
    }

    pub const fn executor(&self) -> &E {
        return &self.executor;
    }

    pub fn into_executor(self) -> E {
        return self.executor;
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum StackSdkRuntimeError<E> {
    EmptyRoot,
    NonUtf8Root,
    RootTooLong,
    NulRoot,
    Executor(E),
}

impl<E> fmt::Display for StackSdkRuntimeError<E>
where
    E: fmt::Display,
{
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        return match self {
            Self::EmptyRoot => write!(formatter, "stack dev root must be non-empty"),
            Self::NonUtf8Root => write!(formatter, "stack dev root must be valid UTF-8"),
            Self::RootTooLong => write!(
                formatter,
                "stack dev root may contain at most {MAX_STACK_DEV_ROOT_CHARS} characters"
            ),
            Self::NulRoot => write!(formatter, "stack dev root may not contain NUL"),
            Self::Executor(error) => write!(formatter, "stack dev runtime failed: {error}"),
        };
    }
}

impl<E> std::error::Error for StackSdkRuntimeError<E> where E: std::error::Error + 'static {}

#[derive(Debug, PartialEq, Eq)]
enum StackTargetAdmissionError {
    EmptyRoot,
    NonUtf8Root,
    RootTooLong,
    NulRoot,
}

fn admit_root(root: &Path) -> Result<(), StackTargetAdmissionError> {
    if root.as_os_str().is_empty() {
        return Err(StackTargetAdmissionError::EmptyRoot);
    }
    let Some(root_text) = root.to_str() else {
        return Err(StackTargetAdmissionError::NonUtf8Root);
    };
    if root_text.chars().count() > MAX_STACK_DEV_ROOT_CHARS {
        return Err(StackTargetAdmissionError::RootTooLong);
    }
    if root_text.contains('\0') {
        return Err(StackTargetAdmissionError::NulRoot);
    }
    return Ok(());
}

fn admit_target(
    target: StackDevTarget,
) -> Result<AdmittedStackDevTarget, StackTargetAdmissionError> {
    admit_root(target.root())?;

    return Ok(match target {
        StackDevTarget::GeneratedInfra { root } => AdmittedStackDevTarget::GeneratedInfra { root },
        StackDevTarget::Repository { root } => AdmittedStackDevTarget::Repository { root },
    });
}

impl<E> StackSdkBackend for StackRuntimeBackend<E>
where
    E: StackDevExecutor,
{
    type Error = StackSdkRuntimeError<E::Error>;

    fn dev(&self, options: StackDevOptions) -> Result<(), Self::Error> {
        let target = admit_target(options.target).map_err(|error| match error {
            StackTargetAdmissionError::EmptyRoot => StackSdkRuntimeError::EmptyRoot,
            StackTargetAdmissionError::NonUtf8Root => StackSdkRuntimeError::NonUtf8Root,
            StackTargetAdmissionError::RootTooLong => StackSdkRuntimeError::RootTooLong,
            StackTargetAdmissionError::NulRoot => StackSdkRuntimeError::NulRoot,
        })?;

        return match target {
            AdmittedStackDevTarget::GeneratedInfra { root } => self
                .executor
                .dev_generated_infra(&root)
                .map_err(StackSdkRuntimeError::Executor),
            AdmittedStackDevTarget::Repository { root } => self
                .executor
                .dev_repository(&root)
                .map_err(StackSdkRuntimeError::Executor),
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ores_stack_pub_lib_core::sdk::StackSdk;
    use std::cell::RefCell;

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum Call {
        GeneratedInfra(PathBuf),
        Repository(PathBuf),
    }

    #[derive(Debug, Default)]
    struct RecordingExecutor {
        calls: RefCell<Vec<Call>>,
    }

    impl StackDevExecutor for RecordingExecutor {
        type Error = &'static str;

        fn dev_generated_infra(&self, root: &Path) -> Result<(), Self::Error> {
            self.calls
                .borrow_mut()
                .push(Call::GeneratedInfra(root.to_path_buf()));
            return Ok(());
        }

        fn dev_repository(&self, root: &Path) -> Result<(), Self::Error> {
            self.calls
                .borrow_mut()
                .push(Call::Repository(root.to_path_buf()));
            return Ok(());
        }
    }

    #[test]
    fn public_sdk_dispatches_explicit_generated_infra_target() {
        let sdk = StackSdk::new(StackRuntimeBackend::new(RecordingExecutor::default()));
        sdk.dev(StackDevOptions::generated_infra("alpha-infra"))
            .expect("generated infra dev");

        assert_eq!(
            sdk.backend().executor().calls.borrow().as_slice(),
            &[Call::GeneratedInfra(PathBuf::from("alpha-infra"))]
        );
    }

    #[test]
    fn public_sdk_dispatches_explicit_repository_target() {
        let sdk = StackSdk::new(StackRuntimeBackend::new(RecordingExecutor::default()));
        sdk.dev(StackDevOptions::repository("alpha-api"))
            .expect("repository dev");

        assert_eq!(
            sdk.backend().executor().calls.borrow().as_slice(),
            &[Call::Repository(PathBuf::from("alpha-api"))]
        );
    }

    fn assert_admission_failure(root: PathBuf, expected: StackSdkRuntimeError<&'static str>) {
        let sdk = StackSdk::new(StackRuntimeBackend::new(RecordingExecutor::default()));
        let error = sdk
            .dev(StackDevOptions::repository(root))
            .expect_err("invalid root must fail closed");

        assert_eq!(error, expected);
        assert!(sdk.backend().executor().calls.borrow().is_empty());
    }

    #[test]
    fn empty_root_fails_before_runtime_execution() {
        assert_admission_failure(PathBuf::new(), StackSdkRuntimeError::EmptyRoot);
    }

    #[test]
    fn nul_root_fails_before_runtime_execution() {
        assert_admission_failure(PathBuf::from("alpha\0api"), StackSdkRuntimeError::NulRoot);
    }

    #[test]
    fn oversized_root_fails_before_runtime_execution() {
        assert_admission_failure(
            PathBuf::from("a".repeat(MAX_STACK_DEV_ROOT_CHARS + 1)),
            StackSdkRuntimeError::RootTooLong,
        );
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_root_fails_before_runtime_execution() {
        use std::ffi::OsString;
        use std::os::unix::ffi::OsStringExt;

        assert_admission_failure(
            PathBuf::from(OsString::from_vec(vec![0xff, 0xfe])),
            StackSdkRuntimeError::NonUtf8Root,
        );
    }

    #[test]
    fn root_character_limit_counts_unicode_characters_not_utf8_bytes() {
        let root = "é".repeat(MAX_STACK_DEV_ROOT_CHARS);
        let sdk = StackSdk::new(StackRuntimeBackend::new(RecordingExecutor::default()));
        sdk.dev(StackDevOptions::repository(root.clone()))
            .expect("4096 Unicode characters are admitted");
        assert_eq!(
            sdk.backend().executor().calls.borrow().as_slice(),
            &[Call::Repository(PathBuf::from(root))]
        );
    }

    #[test]
    fn sdk_runtime_module_contains_no_process_spawn_boundary() {
        let source = include_str!("sdk.rs");
        let command_new = concat!("Command", "::new");
        let std_process = concat!("std::", "process");
        let tokio_process = concat!("tokio::", "process");
        assert!(!source.contains(command_new));
        assert!(!source.contains(std_process));
        assert!(!source.contains(tokio_process));
    }
}
