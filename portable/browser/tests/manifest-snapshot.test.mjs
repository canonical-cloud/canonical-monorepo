import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {loadVerifiedCoreGuest} from "../src/artifact.mjs";

const section=(id,data)=>[id,data.length,...data];
const name=s=>[s.length,...new TextEncoder().encode(s)];
// Synthetic host fixture: core wasm with bounded 2-page memory, main():i64 -> 42.
// This tests admission races, not compilation by the Oreslang frontend.
const wasm=Uint8Array.from([0,97,115,109,1,0,0,0,
 ...section(1,[1,0x60,0,1,0x7e]),...section(3,[1,0]),
 ...section(5,[1,1,2,2]),...section(7,[2,...name("main"),0,0,...name("memory"),2,0]),
 ...section(10,[1,4,0,0x42,42,0x0b])]);
const h=createHash("sha256").update(wasm).digest("hex");
function manifest(){return {schemaVersion:1,artifactType:"oreslang.core-wasm.i64-v1",
 target:"wasm32",environment:"browser",backend:"wasm",entry:"main",
 wasmSha256:h,wasmBytes:wasm.length,imports:[],requiredCapabilities:[],
 memory:{maximumPages:2},producer:{compilerSha256:h,sourceSha256:h,llvmIrSha256:h}};}

test("manifest admission snapshots all nested fields before asynchronous SHA-256",async()=>{
 const supplied=manifest();
 const pending=loadVerifiedCoreGuest(wasm,supplied);
 supplied.wasmSha256="0".repeat(64);
 supplied.entry="not_the_original_export";
 supplied.memory.maximumPages=256;
 supplied.producer.compilerSha256="invalid";
 supplied.requiredCapabilities.push("clock");
 supplied.imports.push("host.import");
 const result=await pending;
 assert.equal(result.entry(),42n);
 assert.equal(result.manifest.wasmSha256,h);
 assert.equal(result.manifest.entry,"main");
 assert.deepEqual(result.manifest.requiredCapabilities,[]);
 assert.deepEqual(result.manifest.imports,[]);
 assert.equal(result.manifest.memory.maximumPages,2);
 assert.equal(result.manifest.producer.compilerSha256,h);
 assert.equal(Object.isFrozen(result.manifest.memory),true);
});

test("non-JSON and cyclic manifests fail closed before guest execution",async()=>{
 const cycle=manifest();cycle.self=cycle;
 await assert.rejects(loadVerifiedCoreGuest(wasm,cycle),/serialization/);
 await assert.rejects(loadVerifiedCoreGuest(wasm,{...manifest(),wasmSha256:1n}),/serialization/);
});
