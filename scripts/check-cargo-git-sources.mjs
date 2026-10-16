import assert from "node:assert/strict";
import { readFile, readdir, lstat } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

export const approved = Object.freeze({
  web: Object.freeze({
    "https://github.com/canonical-cloud/canonical-interfaces": "0cab33c2b2a494d2368ef1da0ebe5d614b3a96ef",
    "https://github.com/canonical-cloud/canonical-lib-core": "54ce24670694b1f920e4ab69043378db24fd7296",
    "https://github.com/canonical-cloud/canonical-orm-core": "954fd9811b9c6db1acf15d3a282e65395e347b5a",
  }),
  api: Object.freeze({
    "https://github.com/canonical-cloud/canonical-interfaces": "0cab33c2b2a494d2368ef1da0ebe5d614b3a96ef",
    "https://github.com/canonical-cloud/canonical-lib-core": "54ce24670694b1f920e4ab69043378db24fd7296",
    "https://github.com/canonical-cloud/canonical-orm-core": "954fd9811b9c6db1acf15d3a282e65395e347b5a",
    "https://github.com/ORESoftware/k8s-libs-and-shared-defs.git": "55adadc9f6d223d40b28ae66097dfe16930951b1",
    "https://github.com/ORESoftware/api-docs.git": "252ec981bcbaedf5656fc02e5e581f5924d82061",
    "https://github.com/flags-2-env/flags-2-env": "d7bad9ea7dfc657653368237e08903514cdca1ec",
    "https://github.com/ores-otel/ores.otel.log": "ca176fb6768a9750d262a536952268625ffd3a8a",
    "https://github.com/shared-auth/shared-auth-clients": "0b6ceb78a632ec4501dd2d7dca155d91de0e2d89",
  }),
});

const sha40 = /^[a-f0-9]{40}$/;
const allowedSource = (url, rev) => "git+" + url + "?rev=" + rev + "#" + rev;

// This deliberately accepts a restricted, reviewable TOML subset. Unknown
// syntax, new Git remotes and moving revisions must be explicitly reviewed.
export function checkGitSources(kind, manifest, lockfile, additionalManifests = []) {
  assert.ok(Object.hasOwn(approved, kind), "unknown Cargo application");
  const pins = approved[kind];
  const direct = new Set();
  let directCount = 0;
  function inspect(manifestBody, pathLabel, countDirect) {
    for (const original of manifestBody.split(/\r?\n/)) {
      const line = original.trim();
      if (line.startsWith("#") || !/\bgit\s*=/.test(line)) continue;
      const assignment = line.match(/^[A-Za-z0-9_-]+\s*=\s*\{(.*)\}\s*(?:#.*)?$/);
      assert.ok(assignment, "unreviewed Git manifest syntax in " + pathLabel + ": " + original);
      const body = assignment[1];
      const urls = [...body.matchAll(/(?:^|,)\s*git\s*=\s*"([^"]+)"/g)];
      const revs = [...body.matchAll(/(?:^|,)\s*rev\s*=\s*"([^"]+)"/g)];
      assert.equal(urls.length, 1, "Git dependencies require one explicit URL");
      assert.equal(revs.length, 1, "Git dependencies require one immutable revision");
      const url = urls[0][1], rev = revs[0][1];
      assert.match(rev, sha40, "Git revision must be a 40-character commit SHA");
      assert.ok(Object.hasOwn(pins, url), "unapproved Cargo Git repository: " + url);
      assert.equal(rev, pins[url], "unexpected pinned Git commit for " + url);
      assert.doesNotMatch(body, /(?:^|,)\s*(?:branch|tag)\s*=/, "moving Git refs forbidden");
      if (countDirect) { direct.add(url); directCount++; }
    }
  }
  inspect(manifest, "root Cargo.toml", true);
  for (const [pathLabel, body] of additionalManifests) inspect(body, pathLabel, false);
  assert.equal(directCount, kind === "web" ? 3 : 8, "direct Git dependency count changed");
  // A transitive Canonical Interfaces dependency is present in the API lock.
  const requiredDirect = kind === "web" ? Object.keys(pins) :
    Object.keys(pins).filter(url => !url.endsWith("/canonical-interfaces"));
  for (const url of requiredDirect) assert.ok(direct.has(url), "missing manifest Git repo: " + url);

  assert.match(lockfile, /^version\s*=\s*[0-9]+\s*$/m, "invalid lockfile header");
  const packages = lockfile.split(/^\[\[package\]\]\s*$/m).slice(1);
  assert.ok(packages.length > 0, "missing locked packages");
  const seen = new Set();
  for (const pkg of packages) {
    const sourceLine = pkg.match(/^source\s*=\s*(.+)\s*$/m)?.[1]?.trim();
    if (!sourceLine) continue;
    if (!sourceLine.includes("git+")) continue;
    const m = sourceLine.match(/^"(git\+[^"]+)"$/);
    assert.ok(m, "unsupported or malformed Git lockfile source");
    const source = m[1];
    assert.ok(!seen.has(source) || source.startsWith("git+https://github.com/ORESoftware/api-docs.git?"),
      "unexpected duplicate Git source");
    seen.add(source);
    const valid = Object.entries(pins).some(([url, rev]) =>
      source === allowedSource(url, rev));
    assert.ok(valid, "unapproved Git lockfile source: " + source);
  }
  assert.equal(seen.size, Object.keys(pins).length, "Cargo.lock Git source set changed");
  for (const [url, rev] of Object.entries(pins)) {
    assert.ok(seen.has(allowedSource(url, rev)), "missing approved lock source " + url);
  }
  return { application: kind, direct: directCount, sources: seen.size };
}

// Inspect every Cargo manifest in the candidate tree before any Git token is
// exposed, not just the workspace root. A member crate must not be able to add
// an attacker-controlled Git origin while leaving the root manifest untouched.
export async function verifyFilePair(kind, manifestPath, lockPath) {
  const root = manifestPath.slice(0, -"/Cargo.toml".length);
  const extra = [];
  async function walk(dir, depth) {
    assert.ok(depth <= 16, "Cargo manifest discovery exceeded depth bound");
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if ([".git", "node_modules", "target", "dist", ".next"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        assert.fail("unreviewed symbolic link in Cargo source tree: " + path);
      }
      if (entry.isDirectory()) {
        if (entry.name === ".cargo") {
          for (const config of ["config", "config.toml"]) {
            const configPath = join(path, config);
            try { await lstat(configPath); assert.fail("unreviewed Cargo config override: " + configPath); }
            catch (e) { if (e.code !== "ENOENT") throw e; }
          }
        }
        await walk(path, depth + 1);
      } else if (entry.isFile() && entry.name === "Cargo.toml" && path !== manifestPath) {
        extra.push([path, await readFile(path, "utf8")]);
      }
    }
  }
  await walk(root, 0);
  return checkGitSources(kind, await readFile(manifestPath, "utf8"),
    await readFile(lockPath, "utf8"), extra);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = await Promise.all([
    verifyFilePair("web", "apps/canonical-web-server.rs/Cargo.toml", "apps/canonical-web-server.rs/Cargo.lock"),
    verifyFilePair("api", "apps/canonical-api-server.rs/Cargo.toml", "apps/canonical-api-server.rs/Cargo.lock"),
  ]);
  for (const x of results) console.log("Verified immutable Cargo Git sources:", JSON.stringify(x));
  console.log("Static source admission only; no authenticated dependency fetch or compilation was performed.");
}
