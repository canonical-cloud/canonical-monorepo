#!/usr/bin/env node
import {spawnSync} from "node:child_process";
import {isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
const options=Object.fromEntries(process.argv.slice(2).map(x=>{
 const m=/^--(wasm|manifest|browser-module|expected-i64)=(.+)$/.exec(x);
 if(!m)throw Error("unexpected wasm-core conformance argument: "+x);
 return [m[1],m[2]];
}));
for(const key of ["wasm","manifest","browser-module"])
 if(!isAbsolute(options[key]||""))throw Error(key+" must be an absolute path");
if(!/^-?[0-9]+$/.test(options["expected-i64"]||""))throw Error("expected-i64 must be an integer");
const signed64=BigInt(options["expected-i64"]);
if(signed64<-(1n<<63n)||signed64>((1n<<63n)-1n))throw Error("expected-i64 out of signed 64-bit range");
const canonical=signed64.toString();
const child=fileURLToPath(new URL("../src/wasm-guest-child.mjs",import.meta.url));
const run=spawnSync(process.execPath,[child,options.wasm,options.manifest,options["browser-module"],canonical],{
 timeout:5000,encoding:"utf8",maxBuffer:65536,windowsHide:true
});
if(run.error||run.signal||run.status!==0){
 console.error(JSON.stringify({ok:false,reason:run.error?.code||run.signal||"guest mismatch",
  stderr:(run.stderr||"").slice(0,3000)}));
 process.exitCode=1;
}else{
 try{const report=JSON.parse(run.stdout);if(report.ok!==true)throw Error("invalid report");
 console.log(JSON.stringify(report,null,2))}
 catch(error){console.error(error.message);process.exitCode=1}
}
