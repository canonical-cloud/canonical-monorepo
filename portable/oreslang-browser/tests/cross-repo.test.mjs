import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {loadOreslangWasm} from "../src/loader.mjs";

test("loads actual oreslang-wasm C ABI runtime, opt-in cross-repo integration",{
 skip:!process.env.ORESLANG_WASM_RUNTIME_BINARY
},async()=>{
 const bytes=await readFile(process.env.ORESLANG_WASM_RUNTIME_BINARY);
 let calls=0;
 const rt=await loadOreslangWasm(bytes,{
   requestedCapabilities:["clock"],grantedCapabilities:["clock"],
   host:{clockMs:()=>{calls++;return 1234}}
 });
 const e=rt.instance.exports;
 assert.equal(e.ores_rt_abi_version(),1);
 assert.equal(e.ores_rt_clock_ms(),1234);
 assert.equal(calls,1);
 for(let i=0;i<8;i++)assert.equal(e.ores_rt_enqueue(i+20),1);
 assert.equal(e.ores_rt_enqueue(999),0);
 for(let i=0;i<8;i++){assert.equal(e.ores_rt_dequeue(),1);assert.equal(e.ores_rt_last_message(),i+20)}
 assert.equal(e.ores_rt_dequeue(),0);
});
test("loads actual native Oreslang source-to-wasm pure guest, opt-in",{
 skip:!process.env.ORESLANG_GUEST_WASM
},async()=>{
 const bytes=await readFile(process.env.ORESLANG_GUEST_WASM);
 const rt=await loadOreslangWasm(bytes,{requireRuntimeABI:false});
 assert.equal(typeof rt.instance.exports.main,"function");
 assert.equal(rt.instance.exports.main(),42n);
 assert.equal(WebAssembly.Module.imports(rt.module).length,0);
});
