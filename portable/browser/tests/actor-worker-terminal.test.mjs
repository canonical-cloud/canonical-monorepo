import test from "node:test";
import assert from "node:assert/strict";
import {encodeActorMessageV2} from "../src/messagepack-v2.mjs";

test("in-flight decode must not ACK after concurrent terminal CONTROL panic",async()=>{
 const schemaId="example.Compute#variant=1",descriptor="T[S,I]";
 const frame=await encodeActorMessageV2({schemaId,descriptor,value:["secret",42n]});
 const originalSelf=Object.getOwnPropertyDescriptor(globalThis,"self");
 const originalCrypto=Object.getOwnPropertyDescriptor(globalThis,"crypto");
 const realDigest=globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
 let handler,releaseDigest;
 const sent=[];
 try{
  Object.defineProperty(globalThis,"self",{configurable:true,value:{
   addEventListener(kind,fn){if(kind==="message")handler=fn},
   postMessage(message){sent.push(message)}
  }});
  // Keep the first decoded frame suspended at the SHA boundary. A second
  // DATA must trigger a terminal panic before the first digest completes.
  Object.defineProperty(globalThis,"crypto",{configurable:true,value:{subtle:{
   digest:(algo,bytes)=>new Promise((resolve,reject)=>{
    releaseDigest=()=>realDigest(algo,bytes).then(resolve,reject);
   })
  }}});
  await import("../src/actor-message-worker.mjs?terminal-panic-regression=1");
  assert.equal(typeof handler,"function");
  await handler({data:{kind:"oreslang-v2-init",schemaId,descriptor}});
  assert.deepEqual(sent,[{kind:"oreslang-v2-ready"}]);
  const originalInput=Uint8Array.from(frame);
  const decoding=handler({data:{kind:"oreslang-v2-data",id:1,frame:originalInput}});
  assert.equal(typeof releaseDigest,"function","first DATA reaches asynchronous digest");
  const rejectedInput=new DataView(Uint8Array.from(frame).buffer);
  await handler({data:{kind:"oreslang-v2-data",id:2,frame:rejectedInput}});
  assert.deepEqual(sent,[{kind:"oreslang-v2-ready"},{kind:"oreslang-v2-panic"}]);
  assert.ok(new Uint8Array(rejectedInput.buffer).every(b=>b===0),
    "rejected DataView is scrubbed even when the endpoint panics");
  releaseDigest();
  await decoding;
  assert.deepEqual(sent,[{kind:"oreslang-v2-ready"},{kind:"oreslang-v2-panic"}],
    "successful decode cannot issue a ghost receipt after panic");
  assert.ok(originalInput.every(b=>b===0),"in-flight owned frame scrubbed");
 }finally{
  if(originalSelf)Object.defineProperty(globalThis,"self",originalSelf);
  else delete globalThis.self;
  if(originalCrypto)Object.defineProperty(globalThis,"crypto",originalCrypto);
  else delete globalThis.crypto;
 }
});
