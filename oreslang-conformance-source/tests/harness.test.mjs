import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {runSuite,validateCommand,loadManifest} from "../src/harness.mjs";
const sha="012345678901234567890123456789abcdefabcd";
const cmd=[process.execPath,new URL("./fake-checker.mjs",import.meta.url).pathname,"{file}"];
test("manifest parses exact fixtures",async()=>{const m=await loadManifest();assert.equal(m.cases.length,2)});
test("unconfigured is explicit and never counted as verified",async()=>{
 const r=await runSuite({backend:"java"});
 assert.equal(r.configured,false);
 assert.equal(r.verified,0);
 assert.equal(r.skipped,2);
 assert.ok(r.results.every(x=>x.status==="UNCONFIGURED"));
});
test("required unconfigured suite exits with non-success state",async()=>{
 const r=await runSuite({backend:"java",requireConfigured:true});
 assert.equal(r.ok,false);
 const p=spawnSync(process.execPath,[new URL("../bin/conformance.mjs",import.meta.url).pathname,"--backend=java","--require"],{encoding:"utf8"});
 assert.notEqual(p.status,0);
 assert.match(p.stdout,/UNCONFIGURED/);
});
test("fake checker only exercises harness accept and reject handling",async()=>{
 const r=await runSuite({backend:"java",argv:cmd,sourceSha:sha});
 assert.equal(r.configured,true);
 assert.equal(r.verified,2);
 assert.equal(r.failed,0);
 assert.ok(r.results.every(x=>x.status==="VERIFIED"));
});
test("same fixtures can be selected for LLVM, without claiming LLVM executed",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha});
 assert.equal(r.verified,2);
});
test("missing executable is not mistaken for valid reject",async()=>{
 const r=await runSuite({backend:"llvm",argv:["/no/such/executable/oreslang","{file}"],sourceSha:sha});
 assert.equal(r.failed,2);
 assert.ok(r.results.every(x=>x.status==="SPAWN_ERROR"));
});
test("no compiler revision or unsafe argument template fails closed",async()=>{
 await assert.rejects(runSuite({backend:"java",argv:cmd}),/SHA/);
 for(const bad of [[],["echo"],["echo","foo{file}"],["echo","{file}","{file}"]])assert.throws(()=>validateCommand(bad));
});
test("nonzero exit without expected error is never accepted",async()=>{
 const r=await runSuite({backend:"java",argv:cmd,sourceSha:sha,spawn:()=>({status:2,stdout:"",stderr:"disk failure"})});
 assert.equal(r.failed,2);
});
test("timeout and signal are never green",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha,spawn:()=>({status:null,signal:null,error:{code:"ETIMEDOUT"}})});
 assert.equal(r.failed,2);
 assert.ok(r.results.every(x=>x.status==="TIMEOUT"));
});

test("verified harness results retain executable and fixture SHA-256 evidence",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha});
 assert.match(r.executableSha256,/^[0-9a-f]{64}$/);
 assert.equal(r.declaredSourceSha,sha);
 assert.match(r.provenanceNote,/does not attest/);
 for(const item of r.results)assert.match(item.fixtureSha256,/^[0-9a-f]{64}$/);
});
test("crash text quoting the symbol is not a real compile-time diagnostic",async()=>{
 const r=await runSuite({backend:"llvm",argv:cmd,sourceSha:sha,spawn:()=>({status:1,stdout:"",stderr:"crash during compilation: nonexistent_symbol"})});
 assert.equal(r.verified,0);
 assert.equal(r.failed,2);
});
test("bad timeouts and PATH-dependent commands are rejected",async()=>{
 for(const timeoutMs of [0,99,120001,NaN,Infinity])await assert.rejects(runSuite({backend:"java",timeoutMs}),/timeoutMs/);
 assert.throws(()=>validateCommand(["node","{file}"]),/absolute/);
});
