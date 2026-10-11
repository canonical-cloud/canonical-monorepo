import test from "node:test";
import assert from "node:assert/strict";
import {loadOreslangWasm} from "../src/loader.mjs";
import {inspectWasmBytes} from "../src/inspect.mjs";

// Real standalone C -> wasm32 fixture, built with Clang and
// --initial-memory=131072 --max-memory=131072.
// It is a host-loader test only, not Oreslang source compilation.
const bytes=Uint8Array.from(Buffer.from("AGFzbQEAAAABDgNgAAF8YAABf2ABfwF/AhYBCW9yZXNfaG9zdAhjbG9ja19tcwAAAwQDAQIABQQBAQICBggBfwFBgIgECwdBBAZtZW1vcnkCABNvcmVzX3J0X2FiaV92ZXJzaW9uAAESb3Jlc19ydF9pbml0aWFsaXplAAIJcnVuX2Nsb2NrAAMKFwMEAEEBCwcAIABBAkkLCAAQgICAgAALAHsEbmFtZQAVFGJyb3dzZXJfZml4dHVyZS53YXNtAUkEABJvcmVzX2hvc3RfY2xvY2tfbXMBE29yZXNfcnRfYWJpX3ZlcnNpb24CEm9yZXNfcnRfaW5pdGlhbGl6ZQMJcnVuX2Nsb2NrBxIBAA9fX3N0YWNrX3BvaW50ZXIAfwlwcm9kdWNlcnMBDHByb2Nlc3NlZC1ieQEFY2xhbmdfMTcuMC4wIChodHRwczovL2dpdGh1Yi5jb20vc3dpZnRsYW5nL2xsdm0tcHJvamVjdC5naXQgMTA5OTliNmQwMzRmZTMxOGYzZDU2YzgzYmRkYjY1NzI1OTNhOGJiMCkASQ90YXJnZXRfZmVhdHVyZXMEKwptdWx0aXZhbHVlKw9tdXRhYmxlLWdsb2JhbHMrD3JlZmVyZW5jZS10eXBlcysIc2lnbi1leHQ=","base64"));
const config={requestedCapabilities:["clock"],grantedCapabilities:["clock"],host:{clockMs:()=>42}};
test("binary is real Wasm with explicit fixed maximum memory",()=>{
 assert.equal(WebAssembly.validate(bytes),true);
 assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(bytes)).map(x=>x.module+"."+x.name),["ores_host.clock_ms"]);
 assert.deepEqual(((m)=>[m.memoryInitial,m.memoryMaximum])(inspectWasmBytes(bytes)),[2,2]);
});
test("explicit request and independent grant enable clock",async()=>{
 const rt=await loadOreslangWasm(bytes,config);
 assert.equal(rt.instance.exports.ores_rt_abi_version(),1);
 assert.equal(rt.instance.exports.run_clock(),42);
 assert.equal(rt.hostClockCalls,1);
});
test("missing grant denies before instantiation",async()=>{
 await assert.rejects(()=>loadOreslangWasm(bytes,{...config,grantedCapabilities:[]}),/not granted/);
});
test("host import traps when module requests no capabilities",async()=>{
 const rt=await loadOreslangWasm(bytes,{...config,requestedCapabilities:[]});
 assert.throws(()=>rt.instance.exports.run_clock(),/clock capability denied/);
 assert.equal(rt.hostClockCalls,0);
});
test("guest cannot elevate authority using exported initialization mask",async()=>{
 let calls=0;
 const rt=await loadOreslangWasm(bytes,{grantedCapabilities:[],requestedCapabilities:[],host:{clockMs:()=>{calls++;return 17}}});
 assert.equal(rt.instance.exports.ores_rt_initialize(1),1);
 assert.throws(()=>rt.instance.exports.run_clock(),/clock capability denied/);
 assert.equal(calls,0);
});
test("clock request requires host provider",async()=>{
 await assert.rejects(()=>loadOreslangWasm(bytes,{...config,host:{}}),/provider/);
});
test("unknown grants, duplicates, malformed buffers and precompiled modules rejected",async()=>{
 for(const change of [{requestedCapabilities:["fs.read"]},{grantedCapabilities:["clock","clock"]}]){
  await assert.rejects(()=>loadOreslangWasm(bytes,{...config,...change}),/unique list/);
 }
 await assert.rejects(()=>loadOreslangWasm("not wasm",config),/expected a Wasm/);
 await assert.rejects(()=>loadOreslangWasm(new WebAssembly.Module(bytes),config),/cannot be inspected/);
});
test("unknown imported host module rejected",async()=>{
 const bad=bytes.slice();
 const from=new TextEncoder().encode("ores_host"),to=new TextEncoder().encode("evil_host");
 let found=false;
 for(let i=0;i<bad.length-from.length;i++){
  if(from.every((v,j)=>bad[i+j]===v)){bad.set(to,i);found=true;break}
 }
 assert.equal(found,true);
 assert.equal(WebAssembly.validate(bad),true);
 await assert.rejects(()=>loadOreslangWasm(bad,config),/unauthorized Wasm import/);
});
test("unbounded module memory and over-budget limits rejected",async()=>{
 // The initial 32-bit memory declaration section is 05 04 01 01 02 02.
 const pattern=[5,4,1,1,2,2];
 let at=-1;
 for(let i=8;i<bytes.length-pattern.length;i++)if(pattern.every((v,j)=>bytes[i+j]===v)){at=i;break}
 assert.ok(at>0);
 const unbounded=Uint8Array.from([...bytes.slice(0,at),5,3,1,0,2,...bytes.slice(at+6)]);
 assert.equal(WebAssembly.validate(unbounded),true);
 await assert.rejects(()=>loadOreslangWasm(unbounded,config),/maximum limits/);
 await assert.rejects(()=>loadOreslangWasm(bytes,{...config,maxMemoryPages:1}),/budget/);
 await assert.rejects(()=>loadOreslangWasm(bytes,{...config,maxModuleBytes:50}),/maximum byte size/);
});
test("invalid version, malformed wasm and impossible memory policies rejected",()=>{
 assert.throws(()=>inspectWasmBytes(Uint8Array.of(0,1,2,3)),/module header/);
 assert.throws(()=>inspectWasmBytes(bytes,{maxMemoryPages:0}),/invalid maximum/);
 assert.throws(()=>inspectWasmBytes(bytes,{maxModuleBytes:0}),/invalid maximum/);
});

test("clock provider cannot smuggle negative or nonfinite time into Wasm",async()=>{
 for(const bad of [NaN,Infinity,-1,"200"]){
  const rt=await loadOreslangWasm(bytes,{...config,host:{clockMs:()=>bad}});
  assert.throws(()=>rt.instance.exports.run_clock(),/finite, nonnegative/);
  assert.equal(rt.hostClockCalls,0);
 }
});
