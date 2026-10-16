import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { approved, checkGitSources, verifyFilePair } from "../scripts/check-cargo-git-sources.mjs";

function fixture(kind) {
  const pins = Object.entries(approved[kind]);
  const direct = kind === "api"
    ? pins.filter(([url]) => !url.endsWith("/canonical-interfaces"))
    : pins;
  const lines = direct.map(([url, rev], i) =>
    "dep" + i + ' = { git = "' + url + '", rev = "' + rev + '" }');
  if (kind === "api") {
    const [url, rev] = pins.find(([url]) => url.includes("/api-docs.git"));
    lines.push('macro-extra = { git = "' + url + '", rev = "' + rev + '" }');
  }
  const manifest = '[package]\nname = "test"\n[dependencies]\n' + lines.join("\n") + "\n";
  const packages = pins.map(([url, rev], i) =>
    '[[package]]\nname = "p' + i + '"\nversion = "1.0.0"\nsource = "git+' + url +
    "?rev=" + rev + "#" + rev + '"\n');
  if (kind === "api") {
    const [url, rev] = pins.find(([url]) => url.includes("/api-docs.git"));
    packages.push('[[package]]\nname = "macro-extra"\nversion = "1.0.0"\nsource = "git+' +
      url + "?rev=" + rev + "#" + rev + '"\n');
  }
  return { manifest, lock: "version = 4\n\n" + packages.join("\n") };
}
test("web exact 3 Git sources admitted", () => {
  const f = fixture("web");
  assert.deepEqual(checkGitSources("web", f.manifest, f.lock), { application: "web", direct: 3, sources: 3 });
});
test("API 8 direct aliases and 8 distinct locked sources admitted", () => {
  const f = fixture("api");
  assert.deepEqual(checkGitSources("api", f.manifest, f.lock), { application: "api", direct: 8, sources: 8 });
});
test("reject arbitrary attacker-owned github.com dependencies", () => {
  const f = fixture("web");
  const bad = f.manifest + 'attacker = { git = "https://github.com/attacker/steal", rev = "' +
    "b".repeat(40) + '" }\n';
  assert.throws(() => checkGitSources("web", bad, f.lock), /unapproved Cargo Git repository/);
});
test("reject credentials embedded in Git remote URL", () => {
  const f = fixture("web");
  assert.throws(() => checkGitSources("web",
    f.manifest.replace("https://github.com/", "https://token@github.com/"), f.lock), /unapproved/);
});
test("reject short or moving revisions and branches", () => {
  const f = fixture("web");
  const rev = Object.values(approved.web)[0];
  assert.throws(() => checkGitSources("web", f.manifest.replace(rev, "main"), f.lock),
    /40-character/);
  assert.throws(() => checkGitSources("web", f.manifest.replace('rev = "' + rev + '"',
    'rev = "' + rev + '", branch = "main"'), f.lock), /moving Git refs/);
});
test("reject a mismatched locked Git tree revision", () => {
  const f = fixture("web");
  assert.throws(() => checkGitSources("web", f.manifest,
    f.lock.replace("#" + Object.values(approved.web)[0], "#" + "c".repeat(40))), /unapproved Git lockfile/);
});
test("reject unexpected additional Git lockfile source", () => {
  const f = fixture("web");
  const malicious = '[[package]]\nname = "evil"\nsource = "git+https://github.com/attacker/repo?rev=' +
    "a".repeat(40) + "#" + "a".repeat(40) + '"\n';
  assert.throws(() => checkGitSources("web", f.manifest, f.lock + malicious), /unapproved Git lockfile/);
});
test("reject partial manifest missing a reviewed source", () => {
  const f = fixture("web");
  const line = f.manifest.split("\n").find(x => x.startsWith("dep0 = "));
  assert.throws(() => checkGitSources("web", f.manifest.replace(line, ""), f.lock), /direct Git dependency count/);
});
test("reject multiline Git dependency syntax pending explicit review", () => {
  const f = fixture("web");
  assert.throws(() => checkGitSources("web", f.manifest.replace("dep0 = { git = ", "dep0 = {\n  git = "),
    f.lock), /unreviewed Git manifest syntax/);
});
test("reject absent or incomplete lockfile", () => {
  const f = fixture("web");
  for(const bad of ["", "version = 4\n", f.lock.slice(0,40)]) {
    assert.throws(() => checkGitSources("web", f.manifest, bad));
  }
});
test("reject unsupported single-quoted lockfile Git source", () => {
  const f = fixture("web");
  assert.throws(() => checkGitSources("web", f.manifest,
    f.lock.replace('source = "git+', "source = 'git+").replace(/(#\w{40})"\n/, "$1'\n")),
    /malformed Git lockfile|lock source set changed/);
});
test("reject unknown application types", () => {
  const f = fixture("web");
  assert.throws(() => checkGitSources("other", f.manifest, f.lock), /unknown Cargo application/);
});

test("reject nested workspace Git origin injection absent from root manifest", () => {
  const f = fixture("web");
  const nested = 'stealer = { git = "https://github.com/attacker/steal", rev = "' + "d".repeat(40) + '" }';
  assert.throws(() => checkGitSources("web", f.manifest, f.lock,
    [["crates/canonical-store/Cargo.toml", "[dependencies]\n" + nested]]), /unapproved Cargo Git repository/);
});
test("permit nested manifests only when they use approved exact immutable pins", () => {
  const f = fixture("web");
  const [url, rev] = Object.entries(approved.web)[0];
  const nested = 'approved = { git = "' + url + '", rev = "' + rev + '" }';
  assert.equal(checkGitSources("web", f.manifest, f.lock,
    [["crates/canonical-store/Cargo.toml", "[dependencies]\n" + nested]]).sources, 3);
});
test("filesystem scan rejects Cargo config rewrites and symlinked candidate inputs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cargo-admission-"));
  try {
    const root = join(dir, "app");
    await mkdir(root);
    const f = fixture("web");
    const workspace = '[workspace]\\nmembers = [".", "crates/canonical-auth", "crates/canonical-config", "crates/canonical-session", "crates/canonical-store", "services/canonical-session-revoker"]\\n';
    await writeFile(join(root, "Cargo.toml"), workspace + f.manifest);
    await writeFile(join(root, "Cargo.lock"), f.lock);
    await mkdir(join(root, "crates", "x"), { recursive: true });
    await writeFile(join(root, "crates", "x", "Cargo.toml"),
      'approved = { git = "https://github.com/attacker/malicious", rev = "' + "e".repeat(40) + '" }\n');
    await assert.rejects(verifyFilePair("web", join(root, "Cargo.toml"), join(root, "Cargo.lock")),
      /unapproved Cargo Git repository/);
    await writeFile(join(root, "crates", "x", "Cargo.toml"), "[dependencies]\nserde = '1'\n");
    await mkdir(join(root, ".cargo"));
    await writeFile(join(root, ".cargo", "config.toml"), '[source.crates-io]\nreplace-with = "attacker"\n');
    await assert.rejects(verifyFilePair("web", join(root, "Cargo.toml"), join(root, "Cargo.lock")),
      /unreviewed Cargo config override/);
    await rm(join(root, ".cargo", "config.toml"));
    await symlink(join(root, "Cargo.toml"), join(root, "crates", "x", "link"));
    await assert.rejects(verifyFilePair("web", join(root, "Cargo.toml"), join(root, "Cargo.lock")),
      /unreviewed symbolic link/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reject Cargo workspace member changes into vendor and nonreviewed crates", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cargo-member-"));
  try {
    const root = join(dir, "app");
    await mkdir(root);
    const f = fixture("web");
    await writeFile(join(root, "Cargo.toml"),
      '[workspace]\nmembers = [".", "vendor/untrusted"]\n' + f.manifest);
    await writeFile(join(root, "Cargo.lock"), f.lock);
    await assert.rejects(verifyFilePair("web", join(root, "Cargo.toml"), join(root, "Cargo.lock")),
      /web workspace member set changed/);
    await writeFile(join(root, "Cargo.toml"),
      '[workspace]\nmembers = [".", "crates/canonical-auth", "crates/canonical-config", "crates/canonical-session", "crates/canonical-store", "services/canonical-session-revoker"]\n' +
      f.manifest + 'local = { path = "vendor/untrusted" }\n');
    await assert.rejects(verifyFilePair("web", join(root, "Cargo.toml"), join(root, "Cargo.lock")),
      /unapproved local Cargo path dependency/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
