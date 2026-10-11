import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {loadVerifiedCoreGuest} from "../src/artifact.mjs";
const section=(id,data)=>[id,data.length,...data];
const name=s=>[s.length,...new TextEncoder().encode(s)];
// Actual raw wasm32 core module: bounded 2-page memory, main():i64 returns 42.
// This is a synthetic host-test guest, not Oreslang source.
const wasm=Uint8Array.from([
 0,97,115,109,1,0,0,0,
 ...section(1,[1,0x60,0,1,0x7e]),
 ...section(3,[1,0]),
 ...section(5,[1,1,2,2]),
 ...section(7,[2,...name("main"),0,0,...name("memory"),2,0]),
 ...section(10,[1,4,0,0x42,42,0x0b])
]);
const h=createHash("sha256").update(wasm).digest("hex");
const manifest={schemaVersion:1,artifactType:"oreslang.core-wasm.i64-v1",
 target:"wasm32",environment:"browser",backend:"wasm",entry:"main",
 wasmSha256:h,wasmBytes:wasm.length,imports:[],requiredCapabilities:[],
 memory:{maximumPages:2},
 producer:{compilerSha256:h,sourceSha256:h,llvmIrSha256:h}};
test("real wasm32 i64 guest is verified and executes 42n",async()=>{
 assert.equal(WebAssembly.validate(wasm),true);
 const rt=await loadVerifiedCoreGuest(wasm,manifest);
 assert.equal(rt.entry(),42n);
});
test("altered bytes fail SHA-256 admission before instantiation",async()=>{
 const forged=wasm.slice();forged[forged.length-2]=43;
 assert.equal(WebAssembly.validate(forged),true);
 await assert.rejects(loadVerifiedCoreGuest(forged,manifest),/SHA-256 mismatch/);
});
test("size, ABI version, entry and memory mismatches fail closed",async()=>{
 for(const bad of [
  {...manifest,wasmBytes:1},
  {...manifest,artifactType:"oreslang.core-wasm.i64-v2"},
  {...manifest,entry:"missing"},
  {...manifest,memory:{maximumPages:3}},
  {...manifest,environment:"ios"},
  {...manifest,requiredCapabilities:["clock"]},
  {...manifest,imports:["evil.invoke"]},
  {...manifest,producer:{compilerSha256:"oops",sourceSha256:h,llvmIrSha256:h}}
 ])await assert.rejects(loadVerifiedCoreGuest(wasm,bad));
});
test("independent memory cap may tighten manifest bound",async()=>{
 await assert.rejects(loadVerifiedCoreGuest(wasm,manifest,{maxMemoryPages:1}),/memory exceeds host budget/);
});
