import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
const apiStep = workflow.split('      - name: Rust API contracts\n')[1]?.split('\n      - name: ')[0];

test('private Cargo token is restricted to API dependency step', () => {
  assert.ok(apiStep, 'API dependency step must exist');
  assert.match(apiStep, /PRIVATE_CARGO_TOKEN: \$\{\{ secrets\.CANONICAL_PRIVATE_CARGO_READ_TOKEN \}\}/);
  const outsideApiStep = workflow.replace(apiStep, '');
  assert.doesNotMatch(outsideApiStep, /CANONICAL_PRIVATE_CARGO_READ_TOKEN|PRIVATE_CARGO_TOKEN/);
});

test('missing private credential fails before API cargo test', () => {
  assert.match(apiStep, /if \[ -z "\$\{PRIVATE_CARGO_TOKEN:-\}" \]; then/);
  assert.match(apiStep, /exit 1/);
  assert.match(apiStep, /cargo test --locked/);
  assert.ok(apiStep.indexOf('exit 1') < apiStep.indexOf('cargo test --locked'));
});

test('credential uses temporary askpass and is not placed in a URL or argv', () => {
  assert.match(apiStep, /GIT_ASKPASS="\$askpass"/);
  assert.match(apiStep, /GIT_TERMINAL_PROMPT=0/);
  assert.match(apiStep, /CARGO_NET_GIT_FETCH_WITH_CLI=true/);
  assert.match(apiStep, /chmod 700 "\$askpass"/);
  assert.doesNotMatch(workflow, /https?:\/\/[^\s"'\x60]*\$\{?PRIVATE_CARGO_TOKEN/i);
  assert.doesNotMatch(workflow, /git config[^\n]*(?:extraheader|authorization)[^\n]*PRIVATE_CARGO_TOKEN/i);
});

test('public test lane has no private Cargo dependency credential', () => {
  const publicTest = workflow.split('  test:\n')[1]?.split('\n  integration-build:')[0];
  assert.ok(publicTest);
  assert.doesNotMatch(publicTest, /PRIVATE_CARGO_TOKEN|CANONICAL_PRIVATE_CARGO_READ_TOKEN/);
});
