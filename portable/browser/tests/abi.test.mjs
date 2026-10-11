import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {loadVerifiedCoreGuest} from "../src/artifact.mjs";

const section=(id,body)=>[id,body.length,...body];
const name=s=>[s.length,...new TextEncoder().encode(s)];
const wrap=({params=[],results=[0x7e],body=[0x42,42]}={})=>{
 const type=[1,0x60,params.length,...params,results.length,...results];
 const code=[0,...body,0x0b];
 return Uint8Array.from([
 0,97,115,109,1,0,0,0,
 ...section(1,type),...section(3,[1,0]),...section(5,[1,1,2,2]),
 ...section(7,[2,...name("main"),0,0,...name("memory"),2,0]),
 ...section(10,[1,code.length,...code])
 ]);
};
const manifest=bytes=>{
 const sha=createHash("sha256").update(bytes).digest("hex");
 return {schemaVersion:1,artifactType:"oreslang.core-wasm.i64-v1",
  target:"wasm32",environment:"browser",backend:"wasm",entry:"main",
  wasmSha256:sha,wasmBytes:bytes.length,imports:[],requiredCapabilities:[],
  memory:{maximumPages:2},
  producer:{compilerSha256:sha,sourceSha256:sha,llvmIrSha256:sha}};
};
test("exact zero-argument signed i64 entry passes static ABI admission",async()=>{
 const bytes=wrap();
 assert.equal(WebAssembly.validate(bytes),true);
 const guest=await loadVerifiedCoreGuest(bytes,manifest(bytes));
 assert.equal(guest.entry(),42n);
});
test("valid Wasm with i32 entry cannot impersonate i64-v1",async()=>{
 const bytes=wrap({results:[0x7f],body:[0x41,42]});
 assert.equal(WebAssembly.validate(bytes),true);
 await assert.rejects(loadVerifiedCoreGuest(bytes,manifest(bytes)),/exact \(\) -> i64/);
});
test("valid Wasm with an i64 parameter cannot impersonate zero-argument entry",async()=>{
 const bytes=wrap({params:[0x7e],body:[0x42,42]});
 assert.equal(WebAssembly.validate(bytes),true);
 await assert.rejects(loadVerifiedCoreGuest(bytes,manifest(bytes)),/exact \(\) -> i64/);
});
test("valid Wasm returning no results is not a core-i64 guest",async()=>{
 const bytes=wrap({results:[],body:[0x01]});
 assert.equal(WebAssembly.validate(bytes),true);
 await assert.rejects(loadVerifiedCoreGuest(bytes,manifest(bytes)),/exact \(\) -> i64/);
});
