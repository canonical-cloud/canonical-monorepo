import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const cli=fileURLToPath(new URL("../bin/verify-portable-release-mirror.mjs",import.meta.url));
const hash=b=>createHash("sha1").update(Buffer.from("blob "+b.length+"\0")).update(b).digest("hex");
const run=(dir,manifest)=>spawnSync(process.execPath,[cli,
 "--root="+dir,"--manifest="+manifest,"--expected-files=1","--expected-sources=1"],{
  encoding:"utf8",timeout:5000
 });
test("offline Git-blob source gate rejects tampering, symlinks and path traversal",async()=>{
 const root=await mkdtemp(join(tmpdir(),"ores-native-tree-gate-"));
 try{
  const folder=join(root,"portable/browser");await mkdir(folder,{recursive:true});
  const filename=join(folder,"artifact.mjs"),bytes=Buffer.from("export const value=42;\n");
  await writeFile(filename,bytes);
  const manifest=join(root,"manifest.json");
  const doc={schemaVersion:1,sources:[{
   repository:"ores-truffle-oreslang/oreslang-browser",
   headCommit:"a".repeat(40),headTree:"b".repeat(40),count:1
  }],files:[{path:"portable/browser/artifact.mjs",blobSha:hash(bytes)}]};
  const save=()=>writeFile(manifest,JSON.stringify(doc));
  await save();
  let r=run(root,manifest);
  assert.equal(r.status,0,r.stderr);
  assert.deepEqual(JSON.parse(r.stdout),{ok:true,files:1,sources:1});
  await writeFile(filename,"export const value=43;\n");
  r=run(root,manifest);assert.notEqual(r.status,0);
  assert.match(r.stderr,/source Git blob mismatch/);
  await writeFile(filename,bytes);
  doc.files[0].path="portable/browser/../browser/artifact.mjs";
  await save();r=run(root,manifest);assert.notEqual(r.status,0);
  assert.match(r.stderr,/invalid or repeated mirror path/);
  doc.files[0].path="portable/browser/artifact.mjs";
  doc.sources[0].count=2;
  await save();r=run(root,manifest);assert.notEqual(r.status,0);
  assert.match(r.stderr,/source count mismatch/);
  doc.sources[0].count=1;
  const actual=join(folder,"actual.mjs");await writeFile(actual,bytes);
  await rm(filename);await symlink(actual,filename);
  await save();r=run(root,manifest);assert.notEqual(r.status,0);
  assert.match(r.stderr,/invalid or oversized executed source file|symlink/);
  await rm(filename);await writeFile(filename,bytes);
  doc.files.push({...doc.files[0]});
  await save();r=run(root,manifest);assert.notEqual(r.status,0);
  assert.match(r.stderr,/incomplete source manifest/);
 }finally{await rm(root,{recursive:true,force:true})}
});
test("source gate rejects omitted pins and unexpected options before any execution",()=>{
 const p=spawnSync(process.execPath,[cli],{encoding:"utf8"});
 assert.notEqual(p.status,0);assert.match(p.stderr,/required/);
 const q=spawnSync(process.execPath,[cli,"--arbitrary=yes"],{encoding:"utf8"});
 assert.notEqual(q.status,0);assert.match(q.stderr,/unknown\/duplicate option/);
});
