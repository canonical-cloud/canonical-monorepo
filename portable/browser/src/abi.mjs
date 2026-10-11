/**
 * Fail-closed static validator for the narrow core-wasm.i64-v1 ABI.
 * Caller must first run inspectWasmBytes (WebAssembly.validate) and reject
 * *all* imports. This reader only supports plain Wasm function types.
 */
export function assertCoreI64Entry(bytes,entry) {
  let at=8;
  const u32=end=>{
    let value=0;
    for(let i=0;i<5;i++){
      if(at>=end)throw Error("truncated Wasm ABI field");
      const b=bytes[at++];
      if(i===4&&(b&0xf0))throw Error("invalid Wasm ABI integer");
      value+=(b&127)*2**(7*i);
      if(!(b&128))return value;
    }
    throw Error("overlong Wasm ABI integer");
  };
  const typeSignatures=[],functionTypes=[];
  let exportedTypeIndex;
  const decoder=new TextDecoder("utf-8",{fatal:true});
  while(at<bytes.length){
    const id=bytes[at++],length=u32(bytes.length),end=at+length;
    if(end>bytes.length)throw Error("truncated Wasm ABI section");
    if(id===1){
      const count=u32(end);
      for(let i=0;i<count;i++){
        if(at>=end||bytes[at++]!==0x60)
          throw Error("unsupported Wasm ABI function type");
        const nparams=u32(end),params=[];
        if(nparams>end-at)throw Error("invalid Wasm ABI parameter count");
        for(let p=0;p<nparams;p++)params.push(bytes[at++]);
        const nresults=u32(end),results=[];
        if(nresults>end-at)throw Error("invalid Wasm ABI result count");
        for(let p=0;p<nresults;p++)results.push(bytes[at++]);
        typeSignatures.push({params,results});
      }
      if(at!==end)throw Error("malformed Wasm ABI type section");
    }else if(id===3){
      const count=u32(end);
      if(count>(end-at))throw Error("invalid Wasm ABI function count");
      for(let i=0;i<count;i++)functionTypes.push(u32(end));
      if(at!==end)throw Error("malformed Wasm ABI function section");
    }else if(id===7){
      const count=u32(end);
      for(let i=0;i<count;i++){
        const nameLength=u32(end);
        if(nameLength>end-at)throw Error("malformed Wasm ABI export name");
        const name=decoder.decode(bytes.subarray(at,at+nameLength));
        at+=nameLength;
        if(at>=end)throw Error("truncated Wasm ABI export");
        const kind=bytes[at++],index=u32(end);
        if(name===entry){
          if(kind!==0)throw Error("core Wasm entry is not a function");
          exportedTypeIndex=functionTypes[index];
        }
      }
      if(at!==end)throw Error("malformed Wasm ABI export section");
    }
    at=end;
  }
  const signature=typeSignatures[exportedTypeIndex];
  if(!signature||signature.params.length!==0||
      signature.results.length!==1||signature.results[0]!==0x7e)
    throw Error("core Wasm entry must have exact () -> i64 signature");
}
