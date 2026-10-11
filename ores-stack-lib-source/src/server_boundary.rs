//! Deployment and request admission rules that bind a server role to the
//! authority it is permitted to receive.

use crate::server::{ServerCapability, ServerRole};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CredentialClass {
    ReadOnly,
    ReadWrite,
    Admin,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseClass {
    ReadReplica,
    Application,
    Admin,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NetworkExposure {
    Public,
    Private,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeploymentBoundary {
    pub role: ServerRole,
    pub credential_class: CredentialClass,
    pub database_class: DatabaseClass,
    pub network_exposure: NetworkExposure,
    #[serde(default)]
    pub capabilities: Vec<ServerCapability>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OperationClass {
    Read,
    Mutation,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct RequestAdmissionEvidence {
    pub operation: OperationClass,
    pub authenticated: bool,
    pub tenant_authorized: bool,
    pub validated: bool,
    pub idempotency_key_verified: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BoundaryError {
    #[error("web/read server must use a read-only credential")]
    WebCredential,
    #[error("web/read server may not receive authoritative write capability")]
    WebWriteCapability,
    #[error("web/read server must use a read replica")]
    WebDatabase,
    #[error("API/write server must use an application read-write credential")]
    ApiCredential,
    #[error("API/write server must use an application database")]
    ApiDatabase,
    #[error("admin server must use an admin credential")]
    AdminCredential,
    #[error("admin server must use an admin database")]
    AdminDatabase,
    #[error("admin server must be private-network-only")]
    AdminPublicExposure,
    #[error("non-admin server may not receive admin credentials or databases")]
    AdminAuthorityLeak,
    #[error("web/read server may not admit mutations")]
    MutationOnReadServer,
    #[error("mutation requires authentication")]
    MutationAuthentication,
    #[error("mutation requires tenant authorization")]
    MutationTenantAuthorization,
    #[error("mutation requires request validation")]
    MutationValidation,
    #[error("mutation requires a verified idempotency key")]
    MutationIdempotency,
}

fn is_write_capability(capability: &ServerCapability) -> bool {
    return matches!(
        capability,
        ServerCapability::DatabaseWrite
            | ServerCapability::QueuePublish
            | ServerCapability::ObjectStorageWrite
    );
}

pub fn validate_deployment_boundary(boundary: &DeploymentBoundary) -> Result<(), BoundaryError> {
    if boundary.role.is_admin() {
        if boundary.credential_class != CredentialClass::Admin {
            return Err(BoundaryError::AdminCredential);
        }
        if boundary.database_class != DatabaseClass::Admin {
            return Err(BoundaryError::AdminDatabase);
        }
        if boundary.network_exposure != NetworkExposure::Private {
            return Err(BoundaryError::AdminPublicExposure);
        }
        return Ok(());
    }

    if boundary.credential_class == CredentialClass::Admin
        || boundary.database_class == DatabaseClass::Admin
    {
        return Err(BoundaryError::AdminAuthorityLeak);
    }

    match boundary.role {
        ServerRole::Web => {
            if boundary.credential_class != CredentialClass::ReadOnly {
                return Err(BoundaryError::WebCredential);
            }
            if boundary.database_class != DatabaseClass::ReadReplica {
                return Err(BoundaryError::WebDatabase);
            }
            if boundary.capabilities.iter().any(is_write_capability) {
                return Err(BoundaryError::WebWriteCapability);
            }
        }
        ServerRole::Api => {
            if boundary.credential_class != CredentialClass::ReadWrite {
                return Err(BoundaryError::ApiCredential);
            }
            if boundary.database_class != DatabaseClass::Application {
                return Err(BoundaryError::ApiDatabase);
            }
        }
        ServerRole::AdminWeb | ServerRole::AdminApi => {
            unreachable!("admin roles returned above");
        }
    }
    return Ok(());
}

pub fn admit_request(
    role: ServerRole,
    evidence: RequestAdmissionEvidence,
) -> Result<(), BoundaryError> {
    if evidence.operation == OperationClass::Read {
        if !evidence.authenticated {
            return Err(BoundaryError::MutationAuthentication);
        }
        if !evidence.tenant_authorized {
            return Err(BoundaryError::MutationTenantAuthorization);
        }
        return Ok(());
    }

    if matches!(role, ServerRole::Web | ServerRole::AdminWeb) {
        return Err(BoundaryError::MutationOnReadServer);
    }
    if !evidence.authenticated {
        return Err(BoundaryError::MutationAuthentication);
    }
    if !evidence.tenant_authorized {
        return Err(BoundaryError::MutationTenantAuthorization);
    }
    if !evidence.validated {
        return Err(BoundaryError::MutationValidation);
    }
    if !evidence.idempotency_key_verified {
        return Err(BoundaryError::MutationIdempotency);
    }
    return Ok(());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn web_boundary() -> DeploymentBoundary {
        return DeploymentBoundary {
            role: ServerRole::Web,
            credential_class: CredentialClass::ReadOnly,
            database_class: DatabaseClass::ReadReplica,
            network_exposure: NetworkExposure::Public,
            capabilities: vec![ServerCapability::Http, ServerCapability::DatabaseRead],
        };
    }

    fn mutation() -> RequestAdmissionEvidence {
        return RequestAdmissionEvidence {
            operation: OperationClass::Mutation,
            authenticated: true,
            tenant_authorized: true,
            validated: true,
            idempotency_key_verified: true,
        };
    }

    #[test]
    fn web_server_is_read_only_by_credential_database_and_capability() {
        assert_eq!(validate_deployment_boundary(&web_boundary()), Ok(()));

        let mut credential = web_boundary();
        credential.credential_class = CredentialClass::ReadWrite;
        assert_eq!(
            validate_deployment_boundary(&credential),
            Err(BoundaryError::WebCredential),
        );

        let mut database = web_boundary();
        database.database_class = DatabaseClass::Application;
        assert_eq!(
            validate_deployment_boundary(&database),
            Err(BoundaryError::WebDatabase),
        );

        let mut capability = web_boundary();
        capability.capabilities.push(ServerCapability::DatabaseWrite);
        assert_eq!(
            validate_deployment_boundary(&capability),
            Err(BoundaryError::WebWriteCapability),
        );
    }

    #[test]
    fn web_server_rejects_authoritative_mutations_even_with_valid_evidence() {
        assert_eq!(
            admit_request(ServerRole::Web, mutation()),
            Err(BoundaryError::MutationOnReadServer),
        );
    }

    #[test]
    fn api_mutation_requires_auth_tenant_validation_and_idempotency() {
        let valid = mutation();
        assert_eq!(admit_request(ServerRole::Api, valid), Ok(()));

        let mut unauthenticated = valid;
        unauthenticated.authenticated = false;
        assert_eq!(
            admit_request(ServerRole::Api, unauthenticated),
            Err(BoundaryError::MutationAuthentication),
        );

        let mut cross_tenant = valid;
        cross_tenant.tenant_authorized = false;
        assert_eq!(
            admit_request(ServerRole::Api, cross_tenant),
            Err(BoundaryError::MutationTenantAuthorization),
        );

        let mut unvalidated = valid;
        unvalidated.validated = false;
        assert_eq!(
            admit_request(ServerRole::Api, unvalidated),
            Err(BoundaryError::MutationValidation),
        );

        let mut no_idempotency = valid;
        no_idempotency.idempotency_key_verified = false;
        assert_eq!(
            admit_request(ServerRole::Api, no_idempotency),
            Err(BoundaryError::MutationIdempotency),
        );
    }

    #[test]
    fn public_manifest_cannot_select_admin_authority() {
        let admin = DeploymentBoundary {
            role: ServerRole::AdminApi,
            credential_class: CredentialClass::Admin,
            database_class: DatabaseClass::Admin,
            network_exposure: NetworkExposure::Public,
            capabilities: vec![ServerCapability::Http, ServerCapability::DatabaseWrite],
        };
        assert_eq!(
            validate_deployment_boundary(&admin),
            Err(BoundaryError::AdminPublicExposure),
        );

        let leaked = DeploymentBoundary {
            role: ServerRole::Api,
            credential_class: CredentialClass::Admin,
            database_class: DatabaseClass::Admin,
            network_exposure: NetworkExposure::Public,
            capabilities: vec![ServerCapability::Http, ServerCapability::DatabaseWrite],
        };
        assert_eq!(
            validate_deployment_boundary(&leaked),
            Err(BoundaryError::AdminAuthorityLeak),
        );
    }

    #[test]
    fn valid_admin_deployment_requires_private_admin_only_resources() {
        let boundary = DeploymentBoundary {
            role: ServerRole::AdminApi,
            credential_class: CredentialClass::Admin,
            database_class: DatabaseClass::Admin,
            network_exposure: NetworkExposure::Private,
            capabilities: vec![ServerCapability::Http, ServerCapability::DatabaseWrite],
        };
        assert_eq!(validate_deployment_boundary(&boundary), Ok(()));
    }
}
