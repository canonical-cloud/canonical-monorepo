import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const launcher = fileURLToPath(new URL("../.github/scripts/offline-rust-review.sh", import.meta.url));
const fakeImage = "sha256:" + "a".repeat(64);
const secretCanary = "FAKE_PRIVATE_SOURCE_MUST_NOT_REACH_LOGS";

async function fixture(fail = true) {
  const dir = await mkdtemp(join(tmpdir(), "offline-rust-ci-"));
  const scratch = join(dir, "scratch");
  const cache = join(scratch, "private-cache");
  const bin = join(dir, "bin");
  const web = join(dir, "apps", "canonical-web-server.rs");
  const api = join(dir, "apps", "canonical-api-server.rs");
  await Promise.all([mkdir(cache, {recursive:true}), mkdir(bin), mkdir(web, {recursive:true}), mkdir(api, {recursive:true})]);
  for (const app of [web,api]) {
    await writeFile(join(app, "Cargo.toml"), '[package]\nname = "fake"\nversion = "0.1.0"\n');
    await writeFile(join(app, "Cargo.lock"), "version = 4\n");
  }
  const fakeDocker = join(bin, "docker");
  await writeFile(fakeDocker, '#!/bin/sh\ncase "$1" in\n  image) exit 0 ;;\n  run)\n    printf \'%s\\n\' "$@" > "$MOCK_DOCKER_ARGS"\n    echo "$MOCK_PRIVATE_SOURCE_CANARY"\n    echo "$MOCK_PRIVATE_SOURCE_CANARY" >&2\n    test "$MOCK_FAIL" = 1 && exit 33\n    exit 0 ;;\n  *) exit 55 ;;\nesac\n');
  await chmod(fakeDocker, 0o755);
  const env = {
    PATH: bin + ":" + process.env.PATH,
    RUNNER_TEMP: scratch,
    GITHUB_WORKSPACE: dir,
    CANONICAL_PRIVATE_CARGO_CACHE: cache,
    CANONICAL_RUST_IMAGE_ID: fakeImage,
    MOCK_DOCKER_ARGS: join(dir, "docker-args"),
    MOCK_PRIVATE_SOURCE_CANARY: secretCanary,
    MOCK_FAIL: fail ? "1" : "0",
  };
  return {dir, env, close: () => rm(dir,{recursive:true,force:true})};
}

function execute(f, app, operation) {
  return spawnSync("bash",[launcher, app, operation],{
    encoding:"utf8", timeout:3000, env:f.env
  });
}

test("launcher contains mandatory network, read-only and no-privilege controls", async () => {
  const content = await readFile(launcher,"utf8");
  for (const literal of [
    "--network none","--read-only","--cap-drop ALL",
    "--security-opt no-new-privileges","--pull=never",
    "--pids-limit 256","--user","--ipc none",
    "target=/src,readonly","target=/cargo-cache,readonly",
    "CARGO_NET_OFFLINE=true",
  ]) assert.ok(content.includes(literal), "missing required isolation: " + literal);
  assert.ok(!content.includes("GIT_ASKPASS"), "credential helper must not enter offline code");
  assert.match(content, /private-build\.log" 2>&1/);
  assert.doesNotMatch(content, /cat "\$out\/private-build\.log"/);
  assert.doesNotMatch(content, /docker\s+--privileged|--network\s+host|--mount.*docker\.sock/);
});

test("web workspace and API all-features coverage are kept distinct", async () => {
  const content = await readFile(launcher, "utf8");
  assert.match(content, /-e REVIEW_APP="\$app"/);
  assert.match(content, /cargo test --manifest-path \/src\/Cargo\.toml --workspace --all-targets --locked/);
  assert.match(content, /cargo test --manifest-path \/src\/Cargo\.toml --all-targets --all-features --locked/);
  assert.match(content, /cargo clippy --manifest-path \/src\/Cargo\.toml --all-targets --all-features --locked/);
});
test("all reviewed operations retain hardcoded isolation and redact simulated build output", async () => {
  const f = await fixture(false);
  try {
    for (const app of ["web","api"]) for (const operation of ["lock","fmt","clippy","test"]) {
      const r = execute(f,app,operation);
      assert.equal(r.status,0,r.stderr);
      assert.ok(!r.stdout.includes(secretCanary));
      assert.ok(!r.stderr.includes(secretCanary));
      const args = await readFile(f.env.MOCK_DOCKER_ARGS,"utf8");
      assert.ok(args.includes("--network\nnone\n"));
      assert.ok(args.includes("--read-only\n"));
      assert.ok(args.includes("--cap-drop\nALL\n"));
      assert.ok(args.includes("--security-opt\nno-new-privileges\n"));
      assert.ok(args.includes("--pull=never\n"));
      assert.ok(args.includes(fakeImage+"\n"));
      assert.ok(args.includes("target=/src,readonly"));
      assert.ok(args.includes("target=/cargo-cache,readonly"));
      assert.ok(!args.includes("PRIVATE_CARGO_TOKEN"));
    }
  } finally { await f.close(); }
});

test("failed private compilation does not publish its output into Actions logs", async () => {
  const f = await fixture(true);
  try {
    const r = execute(f,"web","test");
    assert.equal(r.status,1);
    assert.match(r.stderr,/Raw build output was intentionally not published/);
    assert.ok(!r.stdout.includes(secretCanary));
    assert.ok(!r.stderr.includes(secretCanary));
  } finally { await f.close(); }
});

test("unreviewed applications and Cargo modes fail before Docker invocation", async () => {
  const f = await fixture(false);
  try {
    for (const [app,task] of [["attacker","test"],["web","shell"],["api","run"],["web","publish"]]) {
      const r = execute(f,app,task);
      assert.notEqual(r.status,0);
      assert.ok(!r.stdout.includes(secretCanary));
    }
  } finally { await f.close(); }
});

test("mutable image tags and reusable Cargo caches fail closed", async () => {
  const f = await fixture(false);
  try {
    f.env.CANONICAL_RUST_IMAGE_ID = "rust:1.95.0-bookworm";
    assert.notEqual(execute(f,"web","fmt").status,0);
    f.env.CANONICAL_RUST_IMAGE_ID = fakeImage;
    f.env.CANONICAL_PRIVATE_CARGO_CACHE = "/tmp/shared-cargo";
    assert.notEqual(execute(f,"web","fmt").status,0);
  } finally { await f.close(); }
});
