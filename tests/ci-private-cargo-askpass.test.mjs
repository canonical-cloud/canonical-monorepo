import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const helper = fileURLToPath(new URL("../.github/scripts/private-cargo-askpass.sh", import.meta.url));
const fakeToken = "NON_SECRET_TEST_ONLY_TOKEN_12345";

function ask(prompt, token = fakeToken) {
  return spawnSync("sh", [helper, prompt], {
    encoding: "utf8",
    timeout: 3000,
    env: { PATH: process.env.PATH, PRIVATE_CARGO_TOKEN: token },
  });
}

test("helper is explicit, simple POSIX shell and does not log tokens", async () => {
  const s = await readFile(helper, "utf8");
  assert.match(s, /^#!\/bin\/sh/);
  assert.match(s, /set -eu/);
  assert.doesNotMatch(s, /curl|wget|eval|sh -c|bash -c|git config|printf.*stderr/);
  assert.doesNotMatch(s, /\*github\.com\*/);
});

test("exact Git HTTPS username prompt returns only username", () => {
  const r = ask("Username for 'https://github.com':");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "x-access-token\n");
  assert.equal(r.stderr, "");
  assert.ok(!r.stdout.includes(fakeToken));
});

test("exact Git HTTPS password prompt returns only scoped token", () => {
  const r = ask("Password for 'https://x-access-token@github.com':");
  assert.equal(r.status, 0);
  assert.equal(r.stdout, fakeToken + "\n");
  assert.equal(r.stderr, "");
});

test("missing token fails closed without emitting a password", () => {
  const r = ask("Password for 'https://x-access-token@github.com':", "");
  assert.notEqual(r.status, 0);
  assert.equal(r.stdout, "");
  assert.equal(r.stderr, "");
});

test("Git's real credential fill handshake supplies the fake token only for github.com", () => {
  const r = spawnSync("git", ["-c", "credential.helper=", "credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
    timeout: 3000,
    env: {
      PATH: process.env.PATH,
      PRIVATE_CARGO_TOKEN: fakeToken,
      GIT_ASKPASS: helper,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
  assert.equal(r.status, 0, "valid Git credential fill must succeed");
  assert.match(r.stdout, /^protocol=https\nhost=github.com\nusername=x-access-token\npassword=/);
  assert.ok(r.stdout.includes("password=" + fakeToken + "\n"));
});
test("Git credential fill never supplies a password to a lookalike hostname", () => {
  const r = spawnSync("git", ["-c", "credential.helper=", "credential", "fill"], {
    input: "protocol=https\nhost=github.com.attacker.invalid\n\n",
    encoding: "utf8",
    timeout: 3000,
    env: {
      PATH: process.env.PATH,
      PRIVATE_CARGO_TOKEN: fakeToken,
      GIT_ASKPASS: helper,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
  });
  assert.notEqual(r.status, 0);
  assert.ok(!r.stdout.includes(fakeToken));
  assert.ok(!r.stderr.includes(fakeToken));
});
const forbidden = [
  "Password for 'https://github.com':",
  "Password for 'https://evilgithub.com':",
  "Password for 'https://github.com.attacker.invalid':",
  "Password for 'https://api.github.com':",
  "Password for 'http://github.com':",
  "Password for 'https://github.com@attacker.invalid':",
  "Password for 'https://attacker.invalid/github.com':",
  "Password for 'https://github.com.evil.example/path':",
  "Password for 'https://github.com/evil/repo':",
  "Username for 'https://github.com.attacker.invalid':",
  "Username for 'https://github.com@attacker.invalid':",
  "Password for 'HTTPS://github.com':",
  "Password for 'https://GITHUB.com':",
  "Credential for 'https://github.com':",
  "Password for 'https://x-access-token@github.com': trailing injection",
  "",
];
for (const prompt of forbidden) {
  test("reject unexpected credential prompt: " + JSON.stringify(prompt), () => {
    const r = ask(prompt);
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout, "");
    assert.equal(r.stderr, "");
  });
}
