import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {Worker} from "node:worker_threads";
import {pathToFileURL} from "node:url";
import {isAbsolute} from "node:path";
const env=process.env;
const names=["ORE_REAL_WASM","ORE_REAL_MANIFEST","ORE_BROWSER_WORKER_HOST","ORE_BROWSER_WORKER_SHIM"];
const configured=names.every(k=>typeof env[k]==="string"&&isAbsolute(env[k]));
// Required CI must fail, never silently skip when an env input disappears.
if(env.ORE_REQUIRE_REAL_WORKER==="1"&&!configured)
 throw Error("required real compiled Oreslang Worker evidence is unconfigured");
test("native Oreslang .ores artifact runs inside real isolated Worker with verified manifest",{
 skip:configured?false:"requires exact built Oreslang compiler and pinned Worker source"
},async()=>{
 const {runVerifiedCoreGuestInWorker}=await import(pathToFileURL(env.ORE_BROWSER_WORKER_HOST).href);
 const wasm=await readFile(env.ORE_REAL_WASM);
 const manifest=JSON.parse(await readFile(env.ORE_REAL_MANIFEST,"utf8"));
 function isolatedWorker(){
  const w=new Worker(env.ORE_BROWSER_WORKER_SHIM,{type:"module"});
  const handlers=new Map();
  return {
   addEventListener(kind,cb){const handle=kind==="message"?data=>cb({data}):()=>cb({});handlers.set(cb,{kind,handle});w.on(kind,handle)},
   removeEventListener(kind,cb){const h=handlers.get(cb);if(h){w.off(h.kind,h.handle);handlers.delete(cb)}},
   postMessage(data){w.postMessage(data)},
   terminate(){return w.terminate()}
  };
 }
 const result=await runVerifiedCoreGuestInWorker({wasmBytes:wasm,manifest,workerFactory:isolatedWorker,timeoutMs:4000});
 assert.equal(result,42n);
});
