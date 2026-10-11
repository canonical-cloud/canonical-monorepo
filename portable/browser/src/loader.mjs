import {inspectWasmBytes} from "./inspect.mjs";
const KNOWN = new Set(["clock"]);
function checkList(name,value) {
 if(!Array.isArray(value)||value.some((x,i)=>typeof x!=="string"||!KNOWN.has(x)||value.indexOf(x)!==i)){
  throw new TypeError(name+" must be a unique list of supported capabilities");
 }
}
export async function loadOreslangWasm(bytes,{
 requestedCapabilities=[],
 grantedCapabilities=[],
 host={},
 requireRuntimeABI=true,
 maxModuleBytes=1048576,
 maxMemoryPages=32
}={}){
 checkList("requestedCapabilities",requestedCapabilities);
 checkList("grantedCapabilities",grantedCapabilities);
 for(const capability of requestedCapabilities){
  if(!grantedCapabilities.includes(capability))throw new Error("capability not granted by host: "+capability);
 }
 const inspected=inspectWasmBytes(bytes,{maxModuleBytes,maxMemoryPages});
 const module=new WebAssembly.Module(inspected.bytes);
 const imports=WebAssembly.Module.imports(module);
 for(const entry of imports){
  if(entry.module!=="ores_host"||entry.name!=="clock_ms"||entry.kind!=="function"){
   throw new Error("unsupported/unauthorized Wasm import: "+entry.module+"."+entry.name+" ("+entry.kind+")");
  }
 }
 if(requireRuntimeABI){
  const exports=WebAssembly.Module.exports(module);
  for(const [name,kind] of [["memory","memory"],["ores_rt_abi_version","function"],["ores_rt_initialize","function"]]){
   if(!exports.some(x=>x.name===name&&x.kind===kind))throw new Error("missing mandatory Oreslang ABI export: "+name);
  }
  if(inspected.memoryCount!==1||!inspected.hasMemoryMaximum)throw new Error("Oreslang ABI needs one bounded module memory");
 }
 const clockRequested=requestedCapabilities.includes("clock");
 if(clockRequested && typeof host.clockMs!=="function"){
  throw new Error("clock requested but no host.clockMs provider supplied");
 }
 let clockCalls=0;
 const importsObject={ores_host:{
  clock_ms:()=>{
   // Enforcement must happen *inside the host function*, even if guest
   // code calls initialization exports to manipulate its own capability bits.
   if(!clockRequested||!grantedCapabilities.includes("clock"))throw new Error("clock capability denied");
   const value=host.clockMs();
   if(typeof value!=="number"||!Number.isFinite(value)||value<0)
    throw new TypeError("clock provider must return finite, nonnegative milliseconds");
   clockCalls++;
   return value;
  }
 }};
 const instance=new WebAssembly.Instance(module,importsObject);
 if(requireRuntimeABI){
  if(instance.exports.ores_rt_abi_version()!==1){
   throw new Error("unsupported Oreslang core Wasm ABI version");
  }
  const mask=clockRequested?1:0;
  if(instance.exports.ores_rt_initialize(mask)!==1)throw new Error("Wasm runtime initialization failed");
 }
 return {instance,module,get hostClockCalls(){return clockCalls}};
}
