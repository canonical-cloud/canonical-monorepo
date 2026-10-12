import test from "node:test";
import assert from "node:assert/strict";
import {Worker} from "node:worker_threads";
import {encodeActorMessageV2} from "../src/messagepack-v2.mjs";

const contract={schemaId:"example.Compute#variant=1",descriptor:"T[S,I]"};
const workerUrl=new URL("./fixtures/actor-node-worker-shim.mjs",import.meta.url);
function exchange(worker,data){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(Error("isolated actor endpoint response timeout"))},2500);
  const message=value=>{cleanup();resolve(value)};
  const failure=e=>{cleanup();reject(e)};
  function cleanup(){
   clearTimeout(timer);worker.off("message",message);worker.off("error",failure);
  }
  worker.on("message",message);worker.on("error",failure);worker.postMessage(data);
 });
}
const init=w=>exchange(w,{kind:"oreslang-v2-init",...contract});
async function frame(value){
 return encodeActorMessageV2({...contract,value,maxBytes:1024});
}
test("real Worker rejects replayed DATA ticket and emits terminal CONTROL panic",async()=>{
 const w=new Worker(workerUrl,{type:"module"});
 try{
  assert.deepEqual(await init(w),{kind:"oreslang-v2-ready"});
  const bytes=await frame(["first",1n]);
  assert.deepEqual(await exchange(w,{kind:"oreslang-v2-data",id:7,frame:bytes}),{
   kind:"oreslang-v2-receipt",id:7,ok:true
  });
  // Gaps are valid: earlier failed sends may reserve but never dispatch.
  assert.deepEqual(await exchange(w,{kind:"oreslang-v2-data",id:9,frame:bytes}),{
   kind:"oreslang-v2-receipt",id:9,ok:true
  });
  assert.deepEqual(await exchange(w,{kind:"oreslang-v2-data",id:7,frame:bytes}),{
   kind:"oreslang-v2-panic"
  });
 }finally{await w.terminate()}
});
test("real Worker duplicate latest ticket cannot receive a second ACK",async()=>{
 const w=new Worker(workerUrl,{type:"module"});
 try{
  assert.equal((await init(w)).kind,"oreslang-v2-ready");
  const bytes=await frame(["exactly-once",8n]);
  assert.equal((await exchange(w,{kind:"oreslang-v2-data",id:1,frame:bytes})).kind,"oreslang-v2-receipt");
  assert.equal((await exchange(w,{kind:"oreslang-v2-data",id:1,frame:bytes})).kind,"oreslang-v2-panic");
 }finally{await w.terminate()}
});
test("real Worker rejects malformed frame before emitting internal receipt",async()=>{
 const w=new Worker(workerUrl,{type:"module"});
 try{
  assert.equal((await init(w)).kind,"oreslang-v2-ready");
  const bytes=await frame(["bad-hash",8n]);
  // The SHA-256 shape digest is after envelope version and schema ID.
  // Corrupt a schema byte without making the MessagePack frame undecodable.
  const offset=bytes.indexOf(0xc4);
  assert.ok(offset>0);
  bytes[offset+2]^=0x80;
  assert.equal((await exchange(w,{kind:"oreslang-v2-data",id:1,frame:bytes})).kind,"oreslang-v2-panic");
 }finally{await w.terminate()}
});
test("real Worker accepts unique tickets and drains without a second receipt",async()=>{
 const w=new Worker(workerUrl,{type:"module"});
 try{
  assert.equal((await init(w)).kind,"oreslang-v2-ready");
  assert.equal((await exchange(w,{kind:"oreslang-v2-data",id:1,frame:await frame(["one",1n])})).kind,"oreslang-v2-receipt");
  assert.equal((await exchange(w,{kind:"oreslang-v2-data",id:2,frame:await frame(["two",2n])})).kind,"oreslang-v2-receipt");
  assert.equal((await exchange(w,{kind:"oreslang-v2-control",action:"drain"})).kind,"oreslang-v2-stopped");
 }finally{await w.terminate()}
});
