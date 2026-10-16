import assert from "node:assert/strict";
import { test } from "node:test";
import { approved, checkGitSources } from "../scripts/check-cargo-git-sources.mjs";

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
