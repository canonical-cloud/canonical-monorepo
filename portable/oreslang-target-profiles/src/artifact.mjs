import {CAPABILITIES,validateRegistry} from "./contract.mjs";
const hex = value => typeof value==="string" && /^[a-f0-9]{64}$/.test(value);
const exactly=(obj,keys)=>Object.keys(obj).every(k=>keys.includes(k));
const validCaps=value=>Array.isArray(value)&&value.length<=CAPABILITIES.length&&value.every((x,i)=>CAPABILITIES.includes(x)&&value.indexOf(x)===i);
export const CORE_WASM_ABI="oreslang.core-wasm.i64-v1";
export function validateCoreWasmArtifact(manifest,profiles){
 const errors=[];
 if(!manifest||typeof manifest!=="object"||Array.isArray(manifest))return{ok:false,errors:["manifest must be an object"]};
 if(!exactly(manifest,["schemaVersion","artifactType","target","environment","backend","entry","wasmSha256","wasmBytes","requiredCapabilities","imports","memory","producer"]))errors.push("unknown artifact manifest field");
 if(manifest.schemaVersion!==1||manifest.artifactType!==CORE_WASM_ABI)errors.push("unsupported core Wasm artifact version");
 if(manifest.target!=="wasm32"||manifest.backend!=="wasm")errors.push("artifact must declare wasm32/wasm");
 if(typeof manifest.entry!=="string"||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(manifest.entry)||manifest.entry.length>128)errors.push("invalid entry export");
 if(!hex(manifest.wasmSha256)||!Number.isSafeInteger(manifest.wasmBytes)||manifest.wasmBytes<=0||manifest.wasmBytes>16777216)errors.push("invalid Wasm content identity/size");
 if(!validCaps(manifest.requiredCapabilities))errors.push("invalid required capabilities");
 if(!Array.isArray(manifest.imports)||manifest.imports.length!==0)errors.push("core-i64-v1 forbids host imports");
 if(!manifest.memory||typeof manifest.memory!=="object"||Array.isArray(manifest.memory)||
    !exactly(manifest.memory,["maximumPages"])||
    !Number.isSafeInteger(manifest.memory.maximumPages)||manifest.memory.maximumPages<1||manifest.memory.maximumPages>256)
   errors.push("invalid or excessive linear memory bound");
 if(!manifest.producer||typeof manifest.producer!=="object"||Array.isArray(manifest.producer)||
    !exactly(manifest.producer,["compilerSha256","sourceSha256","llvmIrSha256"])||
    !hex(manifest.producer.compilerSha256)||!hex(manifest.producer.sourceSha256)||!hex(manifest.producer.llvmIrSha256))
   errors.push("invalid compiler/source/IR provenance");
 const registry=validateRegistry(profiles);
 if(!registry.ok)errors.push(...registry.errors);
 else{
   const p=profiles.find(x=>x.name===manifest.environment);
   if(!p||!["browser","edge-js","edge-wasi"].includes(manifest.environment)||
      !p.backends.includes("wasm"))errors.push("unsupported Wasm host environment");
   else if(validCaps(manifest.requiredCapabilities)&&
           manifest.requiredCapabilities.some(c=>!p.capabilities.includes(c)))errors.push("capability not supported by target profile");
 }
 // No supported source-level effects yet: no capability-bearing guest accepted.
 if(Array.isArray(manifest.requiredCapabilities)&&manifest.requiredCapabilities.length)errors.push("core-i64-v1 requires an empty capability set");
 return {ok:errors.length===0,errors};
}
