use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const RUNTIME_BINDING_V1: &str = "ores-stack.runtime-binding/v1";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum RuntimeTransport {
    Axum,
    WasmModule,
    WasmComponent,
    LambdaEnvelope,
    Direct,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionModel {
    Handler,
    Actor,
    Hybrid,
}

impl ExecutionModel {
    pub const fn uses_actor(self) -> bool {
        matches!(self, Self::Actor | Self::Hybrid)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum ActorBackend {
    None,
    Ractor,
    Host,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct RuntimeBinding {
    pub contract_version: String,
    pub transport: RuntimeTransport,
    pub execution_model: ExecutionModel,
    pub actor_backend: ActorBackend,
}

impl RuntimeBinding {
    pub fn handler(transport: RuntimeTransport) -> Self {
        Self {
            contract_version: RUNTIME_BINDING_V1.to_owned(),
            transport,
            execution_model: ExecutionModel::Handler,
            actor_backend: ActorBackend::None,
        }
    }

    pub fn validate(&self) -> Result<(), RuntimeBindingError> {
        if self.contract_version != RUNTIME_BINDING_V1 {
            return Err(RuntimeBindingError::Version);
        }

        match (self.execution_model, self.actor_backend) {
            (ExecutionModel::Handler, ActorBackend::None) => Ok(()),
            (ExecutionModel::Handler, ActorBackend::Ractor | ActorBackend::Host) => {
                Err(RuntimeBindingError::ActorBackendWithoutActorExecution)
            }
            (ExecutionModel::Actor | ExecutionModel::Hybrid, ActorBackend::None) => {
                Err(RuntimeBindingError::MissingActorBackend)
            }
            (
                ExecutionModel::Actor | ExecutionModel::Hybrid,
                ActorBackend::Ractor | ActorBackend::Host,
            ) => Ok(()),
        }
    }

    pub fn require_transport(&self, expected: RuntimeTransport) -> Result<(), RuntimeBindingError> {
        self.validate()?;
        if self.transport != expected {
            return Err(RuntimeBindingError::UnsupportedTransport {
                expected,
                actual: self.transport,
            });
        }
        Ok(())
    }

    pub fn require_actor_backend(&self, expected: ActorBackend) -> Result<(), RuntimeBindingError> {
        self.validate()?;
        if self.actor_backend != expected {
            return Err(RuntimeBindingError::UnsupportedActorBackend {
                expected,
                actual: self.actor_backend,
            });
        }
        Ok(())
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RuntimeBindingError {
    #[error("unsupported runtime-binding contract version")]
    Version,
    #[error("handler execution cannot select an actor backend")]
    ActorBackendWithoutActorExecution,
    #[error("actor or hybrid execution requires an actor backend")]
    MissingActorBackend,
    #[error("runtime transport mismatch: expected {expected:?}, found {actual:?}")]
    UnsupportedTransport {
        expected: RuntimeTransport,
        actual: RuntimeTransport,
    },
    #[error("actor backend mismatch: expected {expected:?}, found {actual:?}")]
    UnsupportedActorBackend {
        expected: ActorBackend,
        actual: ActorBackend,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handler_profile_is_valid_without_actor_backend() {
        let binding = RuntimeBinding::handler(RuntimeTransport::Axum);
        assert_eq!(binding.validate(), Ok(()));
    }

    #[test]
    fn actor_profiles_require_an_actor_backend() {
        let missing = RuntimeBinding {
            contract_version: RUNTIME_BINDING_V1.to_owned(),
            transport: RuntimeTransport::Axum,
            execution_model: ExecutionModel::Actor,
            actor_backend: ActorBackend::None,
        };
        assert_eq!(
            missing.validate(),
            Err(RuntimeBindingError::MissingActorBackend)
        );

        let ractor = RuntimeBinding {
            actor_backend: ActorBackend::Ractor,
            ..missing
        };
        assert_eq!(ractor.validate(), Ok(()));
    }

    #[test]
    fn handler_cannot_smuggle_actor_backend() {
        let binding = RuntimeBinding {
            contract_version: RUNTIME_BINDING_V1.to_owned(),
            transport: RuntimeTransport::WasmModule,
            execution_model: ExecutionModel::Handler,
            actor_backend: ActorBackend::Host,
        };
        assert_eq!(
            binding.validate(),
            Err(RuntimeBindingError::ActorBackendWithoutActorExecution)
        );
    }

    #[test]
    fn core_wasm_and_components_have_distinct_wire_names() {
        assert_eq!(
            serde_json::to_string(&RuntimeTransport::WasmModule).unwrap(),
            "\"wasm_module\""
        );
        assert_eq!(
            serde_json::to_string(&RuntimeTransport::WasmComponent).unwrap(),
            "\"wasm_component\""
        );
    }

    #[test]
    fn runtime_binding_rejects_unknown_fields() {
        let json = r#"{
            "contract_version":"ores-stack.runtime-binding/v1",
            "transport":"axum",
            "execution_model":"handler",
            "actor_backend":"none",
            "ambient_authority":"wasi"
        }"#;
        assert!(serde_json::from_str::<RuntimeBinding>(json).is_err());
    }
}
