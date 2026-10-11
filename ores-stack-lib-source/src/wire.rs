use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::InvocationMode;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PayloadCodec {
    Json,
    Messagepack,
    Protobuf,
    Utf8,
    Bytes,
}

impl PayloadCodec {
    #[must_use]
    pub const fn is_structured(self) -> bool {
        matches!(self, Self::Json | Self::Messagepack | Self::Protobuf)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PayloadContract {
    #[serde(default)]
    pub schema_ref: Option<String>,
    pub content_type: String,
    pub codec: PayloadCodec,
}

impl PayloadContract {
    fn validate(&self) -> Result<(), WireContractError> {
        if !valid_nonempty_text(&self.content_type) {
            return Err(WireContractError::ContentType);
        }
        if self
            .schema_ref
            .as_deref()
            .is_some_and(|schema_ref| !valid_nonempty_text(schema_ref))
        {
            return Err(WireContractError::SchemaRef);
        }
        if self.codec.is_structured() && self.schema_ref.is_none() {
            return Err(WireContractError::StructuredSchemaRequired);
        }
        Ok(())
    }
}

/// Serializable provider-neutral request/response representation contract.
///
/// `response` is the unary response body for `request_response` modules and the
/// item/chunk body for `stream` modules. Streaming is intentionally not encoded
/// a second time here; [`InvocationMode`] remains the single framing authority.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ModuleWireContract {
    #[serde(default)]
    pub request: Option<PayloadContract>,
    #[serde(default)]
    pub response: Option<PayloadContract>,
}

impl ModuleWireContract {
    pub fn validate(&self, invocation: InvocationMode) -> Result<(), WireContractError> {
        if let Some(request) = &self.request {
            request.validate()?;
        }
        if let Some(response) = &self.response {
            response.validate()?;
        }

        match invocation {
            InvocationMode::RequestResponse => {}
            InvocationMode::Stream if self.response.is_none() => {
                return Err(WireContractError::StreamResponseRequired);
            }
            InvocationMode::Stream => {}
            InvocationMode::Event if self.response.is_some() => {
                return Err(WireContractError::EventResponseForbidden);
            }
            InvocationMode::Event => {}
        }
        Ok(())
    }
}

/// Const-friendly source form used by server-only [`crate::InternalModule`]
/// implementations. Runtime projection owns the strings in [`PayloadContract`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaticPayloadContract {
    pub schema_ref: Option<&'static str>,
    pub content_type: &'static str,
    pub codec: PayloadCodec,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StaticWireContract {
    pub request: Option<StaticPayloadContract>,
    pub response: Option<StaticPayloadContract>,
}

impl From<StaticPayloadContract> for PayloadContract {
    fn from(value: StaticPayloadContract) -> Self {
        Self {
            schema_ref: value.schema_ref.map(str::to_owned),
            content_type: value.content_type.to_owned(),
            codec: value.codec,
        }
    }
}

impl From<StaticWireContract> for ModuleWireContract {
    fn from(value: StaticWireContract) -> Self {
        Self {
            request: value.request.map(Into::into),
            response: value.response.map(Into::into),
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum WireContractError {
    #[error("payload content_type must be non-empty and contain no control characters")]
    ContentType,
    #[error("payload schema_ref must be non-empty and contain no control characters")]
    SchemaRef,
    #[error("json, messagepack, and protobuf payloads require schema_ref")]
    StructuredSchemaRequired,
    #[error("streaming modules require response payload metadata for each emitted item/chunk")]
    StreamResponseRequired,
    #[error("event modules cannot declare a response payload")]
    EventResponseForbidden,
}

fn valid_nonempty_text(value: &str) -> bool {
    !value.trim().is_empty() && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json_payload() -> PayloadContract {
        PayloadContract {
            schema_ref: Some("#/schemas/widget".to_owned()),
            content_type: "application/json".to_owned(),
            codec: PayloadCodec::Json,
        }
    }

    #[test]
    fn streaming_contract_treats_response_as_item_contract() {
        let wire = ModuleWireContract {
            request: None,
            response: Some(json_payload()),
        };
        assert_eq!(wire.validate(InvocationMode::Stream), Ok(()));
    }

    #[test]
    fn streaming_requires_an_item_contract() {
        let wire = ModuleWireContract {
            request: None,
            response: None,
        };
        assert_eq!(
            wire.validate(InvocationMode::Stream),
            Err(WireContractError::StreamResponseRequired)
        );
    }

    #[test]
    fn events_cannot_pretend_to_have_a_response() {
        let wire = ModuleWireContract {
            request: None,
            response: Some(json_payload()),
        };
        assert_eq!(
            wire.validate(InvocationMode::Event),
            Err(WireContractError::EventResponseForbidden)
        );
    }

    #[test]
    fn structured_codecs_require_schema_authority() {
        let wire = ModuleWireContract {
            request: None,
            response: Some(PayloadContract {
                schema_ref: None,
                content_type: "application/protobuf".to_owned(),
                codec: PayloadCodec::Protobuf,
            }),
        };
        assert_eq!(
            wire.validate(InvocationMode::RequestResponse),
            Err(WireContractError::StructuredSchemaRequired)
        );
    }

    #[test]
    fn html_and_binary_payloads_do_not_need_a_structured_schema() {
        for (codec, content_type) in [
            (PayloadCodec::Utf8, "text/html; charset=utf-8"),
            (PayloadCodec::Bytes, "application/octet-stream"),
        ] {
            let wire = ModuleWireContract {
                request: None,
                response: Some(PayloadContract {
                    schema_ref: None,
                    content_type: content_type.to_owned(),
                    codec,
                }),
            };
            assert_eq!(wire.validate(InvocationMode::RequestResponse), Ok(()));
        }
    }
}
