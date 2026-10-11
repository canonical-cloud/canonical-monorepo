import test from "node:test";
import assert from "node:assert/strict";
import {validateCoreWasmArtifact,CORE_WASM_ABI} from "../src/artifact.mjs";
import {loadProfiles} from "../src/load-registry.mjs";
const profiles=await loadProfiles();
const x="a".repeat(64);
const good={schemaVersion:1,artifactType:CORE_WASM_ABI,target:"wasm32",
 environment:"browser",backend:"wasm",entry:"main",wasmSha256:x,wasmBytes:157,
 requiredCapabilities:[],imports:[],memory:{maximumPages:2},
 producer:{compilerSha256:x,sourceSha256:x,llvmIrSha256:x}};
const check=p=>validateCoreWasmArtifact(p,profiles);
test("canonical pinned pure Wasm guest artifact accepted",()=>assert.deepEqual(check(good),{ok:true,errors:[]}));
test("wasm guest profiles are explicit",()=>{
 for(const environment of ["browser","edge-js","edge-wasi"])assert.equal(check({...good,environment}).ok,true);
 for(const environment of ["server","ios","android","embedded","bad"])assert.equal(check({...good,environment}).ok,false);
});
test("unknown fields, digests, entry, memory bounds and shape rejected",()=>{
 for(const changed of [{...good,secret:true},{...good,wasmSha256:"b"},{...good,entry:"../../x"},
  {...good,memory:{maximumPages:257}},{...good,memory:{maximumPages:2,extra:1}},
  {...good,producer:{...good.producer,compilerSha256:"0"}},
  {...good,wasmBytes:0},{...good,schemaVersion:2},{...good,backend:"llvm"}])
   assert.equal(check(changed).ok,false,JSON.stringify(changed));
});
test("zero-import ABI forbids host calls and capability escalation",()=>{
 assert.equal(check({...good,imports:["ores_host.clock_ms"]}).ok,false);
 assert.equal(check({...good,requiredCapabilities:["clock"]}).ok,false);
 assert.equal(check({...good,requiredCapabilities:["fs.read"]}).ok,false);
});
