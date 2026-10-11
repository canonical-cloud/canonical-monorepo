import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {join} from "node:path";
const dir=fileURLToPath(new URL("../fixtures/structured/",import.meta.url));
const manifest=JSON.parse(await readFile(join(dir,"manifest.json"),"utf8"));
test("explicit verified/pending backend matrix",()=>{
 assert.equal(manifest.schemaVersion,1);
 assert.equal(manifest.scope,"bounded-class-i64-wasm32-v1");
 assert.equal(manifest.cases.length,3);
 assert.match(manifest.graalEvidence,/actions\/runs\/[0-9]+/);
 const ids=new Set();
 for(const c of manifest.cases){
  assert.match(c.id,/^[a-z0-9-]+$/);
  assert.equal(ids.has(c.id),false);ids.add(c.id);
  assert.match(c.file,/^[a-z-]+\.ores$/);
  assert.match(c.sourceGitBlobSha1,/^[a-f0-9]{40}$/);
  const graalIsVerified=c.id==="class-shared-borrow"||
   c.id==="class-overlapping-loans";
  assert.deepEqual(c.confirmedBackends,
   graalIsVerified?["llvm","wasm","graal"]:["llvm","wasm"]);
  assert.deepEqual(c.pendingBackends,graalIsVerified?[]:["graal"]);
  // A native-only interpretation of an unmarked mutable owner is NOT
  // a Java semantic parity success. Do not auto-promote this fixture.
  if(c.id==="class-mutable-borrow")
   assert.equal(c.expectedI64,"42");
  if(c.expect==="accept")assert.equal(c.expectedI64,"42");
  else assert.equal(c.diagnosticClass,"exclusive-loan-conflict");
 }
});
test("structured fixtures retain exact upstream Git blob bytes",async()=>{
 for(const c of manifest.cases){
  const bytes=await readFile(join(dir,c.file));
  const actual=createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex");
  assert.equal(actual,c.sourceGitBlobSha1,c.file+" drifted");
 }
});
