import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const validator = fileURLToPath(new URL("../.github/scripts/verify-public-frontends.py", import.meta.url));
const sha = "a".repeat(40);
const index = "apps/canonical-marketing-site.web/dist/index.html";
const client = "apps/canonical-web-server.rs/client/dist/app.js";
const entries = [["source-commit.txt", sha + "\n"], [index, "<html>public</html>\n"], [client, "console.log(42)\n"]];
const makeTar = "import io,json,sys,tarfile\nitems=json.loads(sys.argv[2])\nwith tarfile.open(sys.argv[1], \"w:gz\") as tar:\n for name, data, *extra in items:\n  typ=extra[0] if extra else \"file\"\n  item=tarfile.TarInfo(name)\n  if typ==\"link\":\n   item.type=tarfile.SYMTYPE\n   item.linkname=data\n   tar.addfile(item)\n  else:\n   data=data.encode(\"utf8\")\n   item.size=len(data)\n   tar.addfile(item,io.BytesIO(data))\n";

async function scenario(modify = x => x, expectedStatus = 0) {
  const dir = await mkdtemp(join(tmpdir(), "public-frontend-test-"));
  try {
    const archive = join(dir, "public.tar.gz");
    const output = join(dir, "verified");
    const list = modify(entries.map(x => [...x]));
    const make = spawnSync("python3", ["-c", makeTar, archive, JSON.stringify(list)], {encoding:"utf8"});
    assert.equal(make.status, 0, make.stderr);
    const r = spawnSync("python3", [validator, archive, output, sha], {encoding:"utf8"});
    assert.equal(r.status, expectedStatus, r.stderr);
    return r;
  } finally { await rm(dir, {recursive:true, force:true}); }
}

test("legitimate exact-commit public marketing/client bundle is accepted", async () => { await scenario(); });
test("an archive carrying a private dependency cache is rejected", async () => {
  const r = await scenario(list => [...list, ["apps/private-cargo/cache", "secret"]], 1);
  assert.match(r.stderr, /nonpublic artifact path/);
});
test("path traversal cannot overwrite runner private files", async () => {
  const r = await scenario(list => [...list, ["../private-credentials", "secret"]], 1);
  assert.match(r.stderr, /unsafe archive path/);
});
test("symlinks to private source paths are rejected", async () => {
  const r = await scenario(list => [...list, [client + ".link", "/home/runner/.cargo", "link"]], 1);
  assert.match(r.stderr, /nonregular artifact entry/);
});
test("substituted source-commit SHA is rejected", async () => {
  const r = await scenario(list => list.map(x => x[0] === "source-commit.txt" ? [x[0], "b".repeat(40)] : x), 1);
  assert.match(r.stderr, /source SHA|does not match/);
});
test("public-only bundle must include verified client output", async () => {
  const r = await scenario(list => list.filter(x => x[0] !== client), 1);
  assert.match(r.stderr, /Public frontend artifact rejected/);
});
