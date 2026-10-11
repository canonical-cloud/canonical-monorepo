import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {Worker} from "node:worker_threads";
import {runVerifiedCoreGuestInWorker} from "../src/worker-host.mjs";
const section=(id,data)=>[id,data.length,...data],name=s=>[s.length,...new TextEncoder().encode(s)];
// Real wasm32 module with bounded 2-page memory and main():i64 -> 42,
// but synthetic host fixture, NOT Oreslang source-language compilation.
const wasm=Uint8Array.from([0,97,115,109,1,0,0,0,
 ...section(1,[1,0x60,0,1,0x7e]),...section(3,[1,0]),
 ...section(5,[1,1,2,2]),...section(7,[2,...name("main"),0,0,...name("memory"),2,0]),
 ...section(10,[1,4,0,0x42,42,0x0b])]);
const h=createHash("sha256").update(wasm).digest("hex");
const artifact={schemaVersion:1,artifactType:"oreslang.core-wasm.i64-v1",
 target:"wasm32",environment:"browser",backend:"wasm",entry:"main",
 wasmSha256:h,wasmBytes:wasm.length,imports:[],requiredCapabilities:[],
 memory:{maximumPages:2},
 producer:{compilerSha256:h,sourceSha256:h,llvmIrSha256:h}};
function isolatedNodeWorker(){
 const w=new Worker(new URL("./fixtures/node-worker-shim.mjs",import.meta.url),{type:"module"});
 const listeners=new Map();
 return {
  addEventListener(kind,callback){
   const handler=kind==="message"?(data)=>callback({data}):()=>callback({});
   listeners.set(callback,{kind,handler});w.on(kind,handler);
  },
  removeEventListener(kind,callback){
   const item=listeners.get(callback);if(item){w.off(item.kind,item.handler);listeners.delete(callback)}
  },
  postMessage(data){w.postMessage(data)},
  terminate(){return w.terminate()}
 };
}
test("verified core i64 guest executes on a real isolated Node Worker",async()=>{
 assert.equal(WebAssembly.validate(wasm),true);
 const result=await runVerifiedCoreGuestInWorker({wasmBytes:wasm,manifest:artifact,workerFactory:isolatedNodeWorker});
 assert.equal(result,42n);
});
test("caller mutations after Worker launch cannot replace validated guest bytes",async()=>{
 const input=wasm.slice(),manifest=structuredClone(artifact);
 const pending=runVerifiedCoreGuestInWorker({wasmBytes:input,manifest,workerFactory:isolatedNodeWorker});
 input.fill(0);manifest.wasmSha256="0".repeat(64);manifest.memory.maximumPages=256;
 assert.equal(await pending,42n);
});
test("invalid SHA-256 and incorrect memory policy are rejected inside worker",async()=>{
 for(const manifest of [
  {...artifact,wasmSha256:"0".repeat(64)},
  {...artifact,memory:{maximumPages:3}},
  {...artifact,requiredCapabilities:["clock"]}
 ])await assert.rejects(runVerifiedCoreGuestInWorker({
  wasmBytes:wasm,manifest,workerFactory:isolatedNodeWorker
 }),/execution rejected/);
});
test("deadline preempts silent worker and performs termination",async()=>{
 let terminated=false;
 const listeners={};
 const fake=()=>({
  addEventListener(k,cb){listeners[k]=cb},
  removeEventListener(k){delete listeners[k]},
  postMessage(){},
  terminate(){terminated=true}
 });
 await assert.rejects(runVerifiedCoreGuestInWorker({
  wasmBytes:wasm,manifest:artifact,workerFactory:fake,timeoutMs:25
 }),/deadline exceeded/);
 assert.equal(terminated,true);
});
test("invalid/malicious Worker reply fails closed",async()=>{
 const fake=reply=>()=>{
  let listener;
  return {
   addEventListener(k,cb){if(k==="message")listener=cb},
   removeEventListener(){},
   postMessage(){queueMicrotask(()=>listener({data:reply}))},
   terminate(){}
  };
 };
 for(const value of ["01","-0","+42","9223372036854775808","not a number",1]){
  await assert.rejects(runVerifiedCoreGuestInWorker({
   wasmBytes:wasm,manifest:artifact,workerFactory:fake({
    kind:"oreslang-core-result-v1",ok:true,value
   })
  }),/signed i64/);
 }
});
test("invalid resource ceilings and missing isolation denied",async()=>{
 for(const opt of [{timeoutMs:0},{timeoutMs:60000},{maxModuleBytes:0},{maxMemoryPages:0}])
  assert.throws(()=>runVerifiedCoreGuestInWorker({
   wasmBytes:wasm,manifest:artifact,...opt,workerFactory:isolatedNodeWorker
  }),/invalid/);
 await assert.rejects(runVerifiedCoreGuestInWorker({
  wasmBytes:wasm,manifest:artifact,workerFactory:()=>({})
 }),/dedicated isolated Worker/);
});


test("pre-aborted signal refuses admission without spawning a Worker",async()=>{
 const controller=new AbortController();controller.abort();
 let created=0;
 await assert.rejects(runVerifiedCoreGuestInWorker({
  wasmBytes:wasm,manifest:artifact,signal:controller.signal,
  workerFactory:()=>{created++;throw Error("must not spawn");}
 }),/worker aborted/);
 assert.equal(created,0);
});
test("abort during Worker factory setup terminates without posting guest bytes",async()=>{
 const controller=new AbortController();
 let terminated=0,posted=0;
 await assert.rejects(runVerifiedCoreGuestInWorker({
  wasmBytes:wasm,manifest:artifact,signal:controller.signal,
  workerFactory:()=>{
   controller.abort();
   return {addEventListener(){},removeEventListener(){},
    postMessage(){posted++},terminate(){terminated++}};
  }
 }),/worker aborted/);
 assert.equal(posted,0);assert.equal(terminated,1);
});
test("abort after posting cancels a pending Worker and removes listeners",async()=>{
 const controller=new AbortController();
 const listeners=new Map();
 let terminated=0,posted=0;
 const workerFactory=()=>({
  addEventListener(k,cb){listeners.set(k,cb)},
  removeEventListener(k){listeners.delete(k)},
  postMessage(){posted++;queueMicrotask(()=>controller.abort())},
  terminate(){terminated++}
 });
 await assert.rejects(runVerifiedCoreGuestInWorker({
  wasmBytes:wasm,manifest:artifact,signal:controller.signal,
  workerFactory,timeoutMs:1000
 }),/worker aborted/);
 assert.equal(posted,1);assert.equal(terminated,1);assert.equal(listeners.size,0);
});
test("abort after verified completion cannot terminate twice",async()=>{
 const controller=new AbortController();
 let terminated=0;
 const workerFactory=()=>{
  let onMessage;
  return {
   addEventListener(k,cb){if(k==="message")onMessage=cb},
   removeEventListener(){},
   postMessage(){
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-core-result-v1",ok:true,value:"42"}}));
   },
   terminate(){terminated++}
  };
 };
 const value=await runVerifiedCoreGuestInWorker({
  wasmBytes:wasm,manifest:artifact,signal:controller.signal,workerFactory
 });
 assert.equal(value,42n);
 controller.abort();
 assert.equal(terminated,1);
});
test("malformed cancellation token fails before spawning Worker",()=>{
 assert.throws(()=>runVerifiedCoreGuestInWorker({
  wasmBytes:wasm,manifest:artifact,signal:{aborted:false}
 }),/AbortSignal/);
});
