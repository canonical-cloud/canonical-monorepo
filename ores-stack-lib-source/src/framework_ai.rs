use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

const QUERY_SCHEMA: &str = "ores.stack.framework-ai.query.v1";
const ANSWER_SCHEMA: &str = "ores.stack.framework-ai.answer.v1";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReleaseRef {
    pub version: String,
    pub git_sha: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Authority {
    Contract,
    Conformance,
    Implementation,
    Deployment,
    Documentation,
    Example,
}

impl Authority {
    #[must_use]
    pub const fn retrieval_weight(self) -> u8 {
        match self {
            Self::Contract => 6,
            Self::Conformance => 5,
            Self::Implementation => 4,
            Self::Deployment => 3,
            Self::Documentation => 2,
            Self::Example => 1,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameworkAiQuery {
    pub schema_version: String,
    pub release: ReleaseRef,
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_output: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_manifest: Option<String>,
}

impl FrameworkAiQuery {
    #[must_use]
    pub fn new(release: ReleaseRef, query: impl Into<String>) -> Self {
        Self {
            schema_version: QUERY_SCHEMA.to_owned(),
            release,
            query: query.into(),
            language: None,
            error_output: None,
            project_manifest: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceChunk {
    pub repo: String,
    #[serde(rename = "ref")]
    pub git_ref: String,
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub content_digest: String,
    pub authority: Authority,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameworkAiAnswer {
    pub schema_version: String,
    pub release: ReleaseRef,
    pub answer: String,
    pub evidence: Vec<EvidenceChunk>,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub adapter_digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corpus_digest: Option<String>,
}

#[derive(Debug, Clone)]
pub struct FrameworkAiPolicy {
    pub endpoint: String,
    pub release: ReleaseRef,
    pub release_match_required: bool,
    pub source_citations_required: bool,
    pub minimum_retrieval_score: f32,
}

impl FrameworkAiPolicy {
    #[must_use]
    pub fn strict(endpoint: impl Into<String>, release: ReleaseRef) -> Self {
        Self {
            endpoint: endpoint.into(),
            release,
            release_match_required: true,
            source_citations_required: true,
            minimum_retrieval_score: 0.20,
        }
    }
}

#[derive(Debug, Error)]
pub enum FrameworkAiError {
    #[error("framework AI query is empty")]
    EmptyQuery,
    #[error("framework AI endpoint returned HTTP {0}")]
    Http(StatusCode),
    #[error("framework AI transport failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("unexpected framework AI response schema: {0}")]
    Schema(String),
    #[error("framework AI answered for release {actual_version}@{actual_sha}, expected {expected_version}@{expected_sha}")]
    ReleaseMismatch {
        expected_version: String,
        expected_sha: String,
        actual_version: String,
        actual_sha: String,
    },
    #[error("framework AI returned no source evidence")]
    MissingEvidence,
    #[error("framework AI evidence score {score} is below required minimum {minimum}")]
    WeakEvidence { score: f32, minimum: f32 },
    #[error("framework AI returned malformed sha256 digest in {field}")]
    InvalidDigest { field: &'static str },
}

#[derive(Clone)]
pub struct FrameworkAiClient {
    http: reqwest::Client,
    policy: FrameworkAiPolicy,
}

impl FrameworkAiClient {
    #[must_use]
    pub fn new(policy: FrameworkAiPolicy) -> Self {
        Self {
            http: reqwest::Client::new(),
            policy,
        }
    }

    pub async fn query(&self, mut request: FrameworkAiQuery) -> Result<FrameworkAiAnswer, FrameworkAiError> {
        if request.query.trim().is_empty() {
            return Err(FrameworkAiError::EmptyQuery);
        }

        request.schema_version = QUERY_SCHEMA.to_owned();
        request.release = self.policy.release.clone();

        let endpoint = format!(
            "{}/v1/framework-ai/query",
            self.policy.endpoint.trim_end_matches('/')
        );
        let response = self.http.post(endpoint).json(&request).send().await?;
        if !response.status().is_success() {
            return Err(FrameworkAiError::Http(response.status()));
        }

        let answer = response.json::<FrameworkAiAnswer>().await?;
        self.verify_answer(&answer)?;
        Ok(answer)
    }

    pub fn verify_answer(&self, answer: &FrameworkAiAnswer) -> Result<(), FrameworkAiError> {
        if answer.schema_version != ANSWER_SCHEMA {
            return Err(FrameworkAiError::Schema(answer.schema_version.clone()));
        }

        if self.policy.release_match_required && answer.release != self.policy.release {
            return Err(FrameworkAiError::ReleaseMismatch {
                expected_version: self.policy.release.version.clone(),
                expected_sha: self.policy.release.git_sha.clone(),
                actual_version: answer.release.version.clone(),
                actual_sha: answer.release.git_sha.clone(),
            });
        }

        if self.policy.source_citations_required && answer.evidence.is_empty() {
            return Err(FrameworkAiError::MissingEvidence);
        }

        for evidence in &answer.evidence {
            if evidence.score < self.policy.minimum_retrieval_score {
                return Err(FrameworkAiError::WeakEvidence {
                    score: evidence.score,
                    minimum: self.policy.minimum_retrieval_score,
                });
            }
            if !is_sha256(&evidence.content_digest) {
                return Err(FrameworkAiError::InvalidDigest {
                    field: "evidence.content_digest",
                });
            }
        }

        if let Some(digest) = &answer.corpus_digest {
            if !is_sha256(digest) {
                return Err(FrameworkAiError::InvalidDigest {
                    field: "corpus_digest",
                });
            }
        }
        if let Some(digest) = &answer.adapter_digest {
            if !is_sha256(digest) {
                return Err(FrameworkAiError::InvalidDigest {
                    field: "adapter_digest",
                });
            }
        }

        Ok(())
    }

    #[must_use]
    pub fn evidence_fingerprint(answer: &FrameworkAiAnswer) -> String {
        let mut hasher = Sha256::new();
        for evidence in &answer.evidence {
            hasher.update(evidence.authority.retrieval_weight().to_be_bytes());
            hasher.update(evidence.repo.as_bytes());
            hasher.update([0]);
            hasher.update(evidence.git_ref.as_bytes());
            hasher.update([0]);
            hasher.update(evidence.path.as_bytes());
            hasher.update([0]);
            hasher.update(evidence.start_line.to_be_bytes());
            hasher.update(evidence.end_line.to_be_bytes());
            hasher.update(evidence.content_digest.as_bytes());
        }
        format!("{:x}", hasher.finalize())
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn release() -> ReleaseRef {
        ReleaseRef {
            version: "0.1.0".to_owned(),
            git_sha: "a".repeat(40),
            channel: Some("stable".to_owned()),
        }
    }

    fn answer() -> FrameworkAiAnswer {
        FrameworkAiAnswer {
            schema_version: ANSWER_SCHEMA.to_owned(),
            release: release(),
            answer: "Use the pinned deploy contract.".to_owned(),
            evidence: vec![EvidenceChunk {
                repo: "ores-stack/ores-stack-interfaces".to_owned(),
                git_ref: "a".repeat(40),
                path: "contracts/ores-stack-deploy.tsp".to_owned(),
                start_line: 1,
                end_line: 20,
                content_digest: "b".repeat(64),
                authority: Authority::Contract,
                score: 0.91,
            }],
            model: "local-model".to_owned(),
            adapter_digest: Some("c".repeat(64)),
            corpus_digest: Some("d".repeat(64)),
        }
    }

    #[test]
    fn strict_policy_accepts_pinned_answer() {
        let client = FrameworkAiClient::new(FrameworkAiPolicy::strict("http://127.0.0.1:9127", release()));
        assert!(client.verify_answer(&answer()).is_ok());
    }

    #[test]
    fn strict_policy_rejects_release_mismatch() {
        let client = FrameworkAiClient::new(FrameworkAiPolicy::strict("http://127.0.0.1:9127", release()));
        let mut value = answer();
        value.release.version = "0.2.0".to_owned();
        assert!(matches!(client.verify_answer(&value), Err(FrameworkAiError::ReleaseMismatch { .. })));
    }

    #[test]
    fn fingerprint_changes_with_evidence() {
        let first = answer();
        let mut second = answer();
        second.evidence[0].end_line += 1;
        assert_ne!(FrameworkAiClient::evidence_fingerprint(&first), FrameworkAiClient::evidence_fingerprint(&second));
    }
}
