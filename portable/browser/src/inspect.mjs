/**
 * Small, bounded reader for the pieces of core Wasm required to enforce
 * loader policy. This is *not* a general Wasm parser or execution sandbox.
 */
export function inspectWasmBytes(input,{maxModuleBytes=1048576,maxMemoryPages=32}={}){
 if(!Number.isSafeInteger(maxModuleBytes)||maxModuleBytes<8||maxModuleBytes>16*1024*1024)throw new TypeError("invalid maximum module size");
 if(!Number.isSafeInteger(maxMemoryPages)||maxMemoryPages<1||maxMemoryPages>256)throw new TypeError("invalid maximum memory pages");
 if(input instanceof WebAssembly.Module)throw new TypeError("precompiled WebAssembly.Module cannot be inspected: provide original bytes");
 let bytes;
 if(input instanceof ArrayBuffer)bytes=new Uint8Array(input);
 else if(ArrayBuffer.isView(input))bytes=new Uint8Array(input.buffer,input.byteOffset,input.byteLength);
 else throw new TypeError("expected a Wasm ArrayBuffer or typed array");
 if(bytes.byteLength>maxModuleBytes)throw new Error("Wasm module exceeds maximum byte size");
 // Snapshot any supplied view before inspecting; never validate bytes that can
 // change between admission and WebAssembly.Module compilation (TOCTOU).
 bytes=Uint8Array.from(bytes);
 const fail=message=>{throw new Error("Wasm admission denied: "+message)};
 if(bytes.length<8||bytes[0]!==0||bytes[1]!==97||bytes[2]!==115||bytes[3]!==109||
    bytes[4]!==1||bytes[5]!==0||bytes[6]!==0||bytes[7]!==0)fail("invalid core module header");
 let at=8;
 const u32=end=>{
  let value=0;
  for(let i=0;i<5;i++){
   if(at>=end)fail("truncated unsigned integer");
   const b=bytes[at++];
   if(i===4&&(b&0xf0)!==0)fail("invalid u32 encoding");
   value+=(b&0x7f)*2**(7*i);
   if((b&0x80)===0)return value;
  }
  fail("overlong unsigned integer");
 };
 let memoryCount=0,hasMemoryMaximum=false,memoryInitial=0,memoryMaximum=0;
 while(at<bytes.length){
  const id=bytes[at++];
  const length=u32(bytes.length);
  const end=at+length;
  if(end>bytes.length)fail("section extends beyond module");
  if(id===8)fail("start section is forbidden (runs before host admission completes)");
  if(id===4)fail("table section is not yet admitted");
  if(id===5){
   const count=u32(end);
   memoryCount+=count;
   if(count>1)fail("more than one memory");
   if(count===1){
    const flags=u32(end);
    if(flags!==1)fail("memory requires fixed initial and maximum limits; shared/memory64 forbidden");
    memoryInitial=u32(end);memoryMaximum=u32(end);
    hasMemoryMaximum=true;
    if(memoryInitial>memoryMaximum||memoryMaximum>maxMemoryPages)fail("linear memory exceeds host budget");
   }
   if(at!==end)fail("malformed memory section");
  }
  at=end;
 }
 if(!WebAssembly.validate(bytes))fail("invalid WebAssembly module");
 return {bytes,memoryCount,hasMemoryMaximum,memoryInitial,memoryMaximum};
}
