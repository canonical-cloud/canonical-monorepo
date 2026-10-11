import {loadVerifiedCoreGuest} from "./artifact.mjs";

// Single-shot dedicated Worker. Do not reuse a guest instance across tenants.
let claimed=false;
self.addEventListener("message",async event=>{
 if(claimed)return;
 claimed=true;
 try{
  const data=event.data;
  if(!data||data.kind!=="oreslang-core-run-v1")throw Error("invalid request");
  const result=await loadVerifiedCoreGuest(data.wasmBytes,data.manifest,{
   maxModuleBytes:data.maxModuleBytes,maxMemoryPages:data.maxMemoryPages
  });
  const value=result.entry();
  if(typeof value!=="bigint"||value<-(1n<<63n)||value>(1n<<63n)-1n)
   throw Error("entry must return signed i64");
  self.postMessage({kind:"oreslang-core-result-v1",ok:true,value:value.toString()});
 }catch{
  // Never expose arbitrary guest error text, host paths or exception stacks.
  self.postMessage({kind:"oreslang-core-result-v1",ok:false,code:"guest-run-failed"});
 }
});
