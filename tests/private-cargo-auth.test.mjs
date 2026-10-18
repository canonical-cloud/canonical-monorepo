import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);

async function workflow() {
  return readFile(workflowUrl, "utf8");
}

test("private Cargo auth is step-scoped and uses askpass instead of credential URLs", async () => {
  const source = await workflow();
  const secretRef = "${{ secrets.CANONICAL_PRIVATE_CARGO_READ_TOKEN }}";

  assert.equal(
    source.split(secretRef).length - 1,
    1,
    "private Cargo secret must be referenced exactly once",
  );
  assert.match(
    source,
    /- name: Rust API contracts[\s\S]*?PRIVATE_CARGO_TOKEN: \$\{\{ secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN \}\}[\s\S]*?GIT_ASKPASS=/,
    "private Cargo token must be scoped to the API contract step and consumed through GIT_ASKPASS",
  );
  assert.match(source, /CARGO_NET_GIT_FETCH_WITH_CLI=true/);
  assert.match(source, /GIT_TERMINAL_PROMPT=0/);
  assert.doesNotMatch(
    source,
    /https:\/\/[^\s/@]+:[^\s@]+@github\.com\//,
    "workflow must never embed username/password credentials in a GitHub URL",
  );
  assert.doesNotMatch(
    source,
    /https:\/\/\$\{\{[^\n]+\}\}@github\.com\//,
    "workflow must never interpolate a secret into a GitHub URL",
  );
  assert.doesNotMatch(
    source,
    /git\s+config[^\n]*(?:extraheader|credential\.helper)[^\n]*PRIVATE_CARGO_TOKEN/i,
    "workflow must not persist the private Cargo token in git configuration",
  );
});

test("missing private Cargo auth fails as an explicit admission boundary", async () => {
  const source = await workflow();
  assert.match(source, /if \[ -z "\$\{PRIVATE_CARGO_TOKEN:-\}" \]; then/);
  assert.match(
    source,
    /CANONICAL_PRIVATE_CARGO_READ_TOKEN with read-only access to canonical-cloud\/canonical-lib-core/,
  );
  assert.match(source, /exit 1/);
});

test("private Cargo askpass never responds to arbitrary hosts or prompt classes", async () => {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const script = fileURLToPath(new URL("../scripts/private-cargo-askpass.sh", import.meta.url));
  const run = (prompt, token = "offline-ci-token") => spawnSync("sh", [script, prompt], {
    env: { PRIVATE_CARGO_TOKEN: token },
    encoding: "utf8",
  });

  for (const prompt of [
    "Password for 'https://evil.example':",
    "Password for 'https://github.com.evil.example':",
    "Password for 'http://x-access-token@github.com':",
    "Password for 'https://x-access-token@github.com.evil.example':",
    "Password for 'https://x-access-token@github.com:8443':",
    "Password for 'https://x-access-token@github.com/repo.git",
    "Password for 'https://x-access-token@github.com/repo.git': ignored",
    "Password for 'https://x-access-token@github.com/repo.git':\nUnexpected",
    "Username for 'https://github.com/repo.git",
    "Username for 'https://github.com/repo.git': ignored",
    "Username for 'https://other.example':",
    "unknown request",
  ]) {
    const output = run(prompt);
    assert.notEqual(output.status, 0, prompt);
    assert.equal(output.stdout, "", prompt);
  }

  assert.equal(run("Username for 'https://github.com':").stdout, "x-access-token\n");
  assert.equal(run("Username for 'https://github.com/canonical-cloud/canonical-lib-core.git':").stdout, "x-access-token\n");
  assert.equal(run("Password for 'https://x-access-token@github.com':").stdout, "offline-ci-token\n");
  assert.equal(run("Password for 'https://x-access-token@github.com/canonical-cloud/canonical-lib-core.git':").stdout, "offline-ci-token\n");
  assert.equal(run("Password for 'https://x-access-token@github.com':", "").stdout, "");
});

test("the ephemeral Cargo credential helper is removed on step exit", async () => {
  const source = await workflow();
  assert.match(source, /install -m 0700 scripts\/private-cargo-askpass\.sh "\$askpass"/);
  assert.match(source, /trap 'rm -f -- "\$askpass"' EXIT/);
  assert.doesNotMatch(source, /cat >"\$askpass"/);
});

test("sidecar credentials stay out of global CI environment and PR checkout", async () => {
  const source = await workflow();
  const globalHeader = source.split("\njobs:\n")[0];
  assert.doesNotMatch(globalHeader, /PRIVATE_SUBMODULE_TOKEN/);
  assert.match(
    source,
    /id: sidecar-auth\n\s+if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
    "private read probe must be restricted to trusted main pushes",
  );
  assert.equal(
    (source.match(/PRIVATE_SUBMODULE_TOKEN: \$\{\{ secrets\.CANONICAL_PRIVATE_SUBMODULES_READ_TOKEN \}\}/g) ?? []).length,
    1,
    "sidecar token may only appear in the trusted availability probe environment",
  );
  assert.equal(
    (source.match(/if: steps\.sidecar-auth\.outputs\.available == 'true'/g) ?? []).length,
    2,
    "private checkout and pin verification must both require the trusted probe",
  );
  assert.doesNotMatch(source, /if: env\.PRIVATE_SUBMODULE_TOKEN/);
});
