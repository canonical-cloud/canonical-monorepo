/**
 * Browser/Node reference codec for canonical Oreslang actor MessagePack v2.
 * Host-side only: NOT yet compiler send/receive lowering or guest Wasm ABI.
 * Format [2, schemaId, bin8(sha256("oreslang.actor.shape.v2/"+shape)), typed payload].
 */
const encoder=new TextEncoder(), decoder=new TextDecoder("utf-8",{fatal:true});
const PREFIX="oreslang.actor.shape.v2/",MAX_BYTES=1048576,MAX_NODES=100000,MAX_DEPTH=64,MAX_DESC=4096;
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
const err=s=>{throw new TypeError("Oreslang MessagePack v2: "+s)};
const isShared=x=>typeof SharedArrayBuffer!=="undefined"&&x instanceof SharedArrayBuffer;
// Admit size BEFORE copying attacker-owned data. An oversized buffer must
// never consume its own length again as a second, unbounded allocation.
const byteCopy=(b,maxBytes)=>{
 if(isShared(b)||ArrayBuffer.isView(b)&&isShared(b.buffer))err("shared memory is forbidden");
 let view;
 if(b instanceof ArrayBuffer)view=new Uint8Array(b);
 else if(ArrayBuffer.isView(b))view=new Uint8Array(b.buffer,b.byteOffset,b.byteLength);
 else err("expected nonshared binary");
 if(view.byteLength>maxBytes)err("frame byte budget");
 return Uint8Array.from(view);
};
function schema(id,desc){
 if(typeof id!=="string"||!/^[\x21-\x7e]{1,256}$/.test(id))err("invalid schema ID");
 if(typeof desc!=="string"||desc.length<1||desc.length>MAX_DESC||!/^[\x21-\x7e]+$/.test(desc))err("invalid shape descriptor");
 let at=0,nodes=0;
 function item(depth){
  if(depth>MAX_DEPTH||++nodes>MAX_NODES)err("shape complexity");
  for(const [token,kind] of [["FA[","fixed"],["FL[","fixed"],["T[","fixed"],["A[","variable"],["L[","variable"]]){
   if(desc.startsWith(token,at)){
    at+=token.length;const children=[];
    if(kind==="fixed"){
     if(desc[at]!=="]"){do{children.push(item(depth+1));if(desc[at]!==",")break;at++}while(true)}
     if(desc[at++]!=="]")err("invalid shape delimiter");
    }else{children.push(item(depth+1));if(desc[at++]!=="]")err("invalid shape delimiter")}
    return {kind:token.slice(0,-1),children};
   }
  }
  const symbol=desc[at++];
  if(!"BIFS".includes(symbol??""))err("unsupported shape");
  return {kind:symbol};
 }
 const type=item(0);
 if(at!==desc.length)err("trailing shape declaration");
 return {id,desc,type};
}
function strBytes(s,budget){
 if(typeof s!=="string")err("expected string");
 // Count the exact UTF-8 size before calling TextEncoder. A hostile string
 // must not trigger a large temporary allocation prior to frame admission.
 let bytes=0;
 for(let i=0;i<s.length;i++){
  const c=s.charCodeAt(i);
  if(c>=0xd800&&c<=0xdbff){
   if(i+1>=s.length||s.charCodeAt(i+1)<0xdc00||s.charCodeAt(i+1)>0xdfff)err("unpaired surrogate");
   i++;bytes+=4;
  }else if(c>=0xdc00&&c<=0xdfff)err("unpaired surrogate");
  else bytes+=c<=0x7f?1:c<=0x7ff?2:3;
  if(bytes>budget)err("frame byte budget");
 }
 return encoder.encode(s);
}
class Writer{
 constructor(limit){this.parts=[];this.bytes=0;this.limit=limit;this.nodes=0}
 visit(d){if(d>MAX_DEPTH||++this.nodes>MAX_NODES)err("value complexity")}
 put(b){if(b.length>this.limit-this.bytes)err("frame byte budget");this.bytes+=b.length;this.parts.push(b)}
 uint(n,b){const a=new Uint8Array(b),v=new DataView(a.buffer);if(b===1)v.setUint8(0,Number(n));else if(b===2)v.setUint16(0,Number(n));else if(b===4)v.setUint32(0,Number(n));else v.setBigUint64(0,BigInt(n));this.put(a)}
 int(n,b){const a=new Uint8Array(b),v=new DataView(a.buffer);if(b===1)v.setInt8(0,Number(n));else if(b===2)v.setInt16(0,Number(n));else if(b===4)v.setInt32(0,Number(n));else v.setBigInt64(0,BigInt(n));this.put(a)}
 tag(b){this.put(Uint8Array.of(b))}
 array(n){if(n<=15)this.tag(0x90+n);else if(n<=65535){this.tag(0xdc);this.uint(n,2)}else{this.tag(0xdd);this.uint(n,4)}}
 string(s){const b=strBytes(s,this.limit-this.bytes);const n=b.length;if(n<=31)this.tag(0xa0+n);else if(n<=255){this.tag(0xd9);this.uint(n,1)}else if(n<=65535){this.tag(0xda);this.uint(n,2)}else{this.tag(0xdb);this.uint(n,4)}this.put(b)}
 integer(value){
  if(typeof value!=="bigint"||value<MIN||value>MAX)err("expected signed i64 BigInt");
  if(value>=0n){if(value<=127n)this.tag(Number(value));else if(value<=255n){this.tag(0xcc);this.uint(value,1)}else if(value<=65535n){this.tag(0xcd);this.uint(value,2)}else if(value<=4294967295n){this.tag(0xce);this.uint(value,4)}else{this.tag(0xcf);this.uint(value,8)}}
  else if(value>=-32n)this.tag(Number(value+256n));else if(value>=-128n){this.tag(0xd0);this.int(value,1)}else if(value>=-32768n){this.tag(0xd1);this.int(value,2)}else if(value>=-2147483648n){this.tag(0xd2);this.int(value,4)}else{this.tag(0xd3);this.int(value,8)}
 }
 binary(b){if(b.length!==32)err("hash must be 32 bytes");this.tag(0xc4);this.uint(32,1);this.put(b)}
 float(x){if(typeof x!=="number"||!Number.isFinite(x))err("finite float64 required");const b=new Uint8Array(9);b[0]=0xcb;new DataView(b.buffer).setFloat64(1,x);this.put(b)}
 finish(){const out=new Uint8Array(this.bytes);let n=0;for(const b of this.parts){out.set(b,n);n+=b.length}return out}
}
class Reader{
 constructor(b){this.b=b;this.i=0;this.dv=new DataView(b.buffer,b.byteOffset,b.byteLength);this.nodes=0}
 visit(d){if(d>MAX_DEPTH||++this.nodes>MAX_NODES)err("value complexity")}
 take(n){if(!Number.isSafeInteger(n)||n<0||n>this.b.length-this.i)err("truncated frame");const v=this.b.subarray(this.i,this.i+n);this.i+=n;return v}
 byte(){return this.take(1)[0]}
 uint(n){const i=this.i;this.take(n);return n===1?BigInt(this.dv.getUint8(i)):n===2?BigInt(this.dv.getUint16(i)):n===4?BigInt(this.dv.getUint32(i)):this.dv.getBigUint64(i)}
 int(n){const i=this.i;this.take(n);return n===1?BigInt(this.dv.getInt8(i)):n===2?BigInt(this.dv.getInt16(i)):n===4?BigInt(this.dv.getInt32(i)):this.dv.getBigInt64(i)}
 array(){const x=this.byte();if(x>=0x90&&x<=0x9f)return x-0x90;if(x===0xdc){const n=Number(this.uint(2));if(n<=15)err("noncanonical array16");return n}if(x===0xdd){const n=Number(this.uint(4));if(n<=65535)err("noncanonical array32");return n}err("expected array")}
 string(){const x=this.byte();let n;if(x>=0xa0&&x<=0xbf)n=x-0xa0;else if(x===0xd9){n=Number(this.uint(1));if(n<=31)err("noncanonical str8")}else if(x===0xda){n=Number(this.uint(2));if(n<=255)err("noncanonical str16")}else if(x===0xdb){n=Number(this.uint(4));if(n<=65535)err("noncanonical str32")}else err("expected string");try{return decoder.decode(this.take(n))}catch{err("invalid UTF-8")}}
 integer(){const x=this.byte();if(x<=0x7f)return BigInt(x);if(x>=0xe0)return BigInt(x-256);
  let v;if(x===0xcc){v=this.uint(1);if(v<=127n)err("noncanonical uint8")}
  else if(x===0xcd){v=this.uint(2);if(v<=255n)err("noncanonical uint16")}
  else if(x===0xce){v=this.uint(4);if(v<=65535n)err("noncanonical uint32")}
  else if(x===0xcf){v=this.uint(8);if(v<=4294967295n||v>MAX)err("noncanonical/out-of-range uint64")}
  else if(x===0xd0){v=this.int(1);if(v>=-32n)err("noncanonical int8")}
  else if(x===0xd1){v=this.int(2);if(v>=-128n)err("noncanonical int16")}
  else if(x===0xd2){v=this.int(4);if(v>=-32768n)err("noncanonical int32")}
  else if(x===0xd3){v=this.int(8);if(v>=-2147483648n)err("noncanonical int64")}
  else err("expected integer");
  return v
 }
 hash(){if(this.byte()!==0xc4||this.byte()!==32)err("expected canonical bin8 SHA-256");return this.take(32)}
 float(){if(this.byte()!==0xcb)err("expected float64");const at=this.i;this.take(8);const x=this.dv.getFloat64(at);if(!Number.isFinite(x))err("nonfinite float");return x}
}
function writeValue(w,t,value,d=0){
 w.visit(d);
 if(t.kind==="B"){if(typeof value!=="boolean")err("expected bool");w.tag(value?0xc3:0xc2);return}
 if(t.kind==="I")return w.integer(value);
 if(t.kind==="F")return w.float(value);
 if(t.kind==="S")return w.string(value);
 if(!Array.isArray(value))err("expected array/tuple");
 if(t.kind!=="A"&&t.kind!=="L"&&value.length!==t.children.length)err("fixed arity mismatch");
 if(value.length>MAX_NODES)err("sequence length budget");
 w.array(value.length);
 for(let i=0;i<value.length;i++)writeValue(w,t.children[t.kind==="A"||t.kind==="L"?0:i],value[i],d+1);
}
function readValue(r,t,d=0){
 r.visit(d);
 if(t.kind==="B"){const x=r.byte();if(x!==0xc2&&x!==0xc3)err("expected bool");return x===0xc3}
 if(t.kind==="I")return r.integer();
 if(t.kind==="F")return r.float();
 if(t.kind==="S")return r.string();
 const len=r.array();
 if(len>MAX_NODES)err("sequence length budget");
 if(t.kind!=="A"&&t.kind!=="L"&&len!==t.children.length)err("fixed arity mismatch");
 const a=[];for(let i=0;i<len;i++)a.push(readValue(r,t.children[t.kind==="A"||t.kind==="L"?0:i],d+1));
 return Object.freeze(a);
}
async function digest(desc){
 if(!globalThis.crypto?.subtle)err("WebCrypto SHA-256 unavailable");
 return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",encoder.encode(PREFIX+desc)));
}
function limit(n){if(!Number.isSafeInteger(n)||n<64||n>MAX_BYTES)err("invalid maxBytes")}
export async function encodeActorMessageV2({schemaId,descriptor,value,maxBytes=MAX_BYTES}={}){
 limit(maxBytes);const t=schema(schemaId,descriptor),w=new Writer(maxBytes);
 w.array(4);w.integer(2n);w.string(t.id);
 // Snapshot serialized payload and schema before crossing async hashing boundary.
 const payload=new Writer(maxBytes);
 try{
  writeValue(payload,t.type,value);
  const bytes=payload.finish();
  try{
   const hash=await digest(t.desc);
   w.binary(hash);w.put(bytes);return w.finish();
  }finally{bytes.fill(0)}
 }finally{
  // Encoded payload fragments and intermediate envelopes are owned by this
  // encoder. Clear each copy on success AND on an asynchronous digest failure.
  for(const part of payload.parts)part.fill(0);
  for(const part of w.parts)part.fill(0);
 }
}
export async function decodeActorMessageV2({schemaId,descriptor,bytes,maxBytes=MAX_BYTES}={}){
 limit(maxBytes);const t=schema(schemaId,descriptor),snapshot=byteCopy(bytes,maxBytes);
 try{
  const r=new Reader(snapshot);
  if(r.array()!==4||r.integer()!==2n)err("version/envelope mismatch");
  if(r.string()!==t.id)err("schema ID mismatch");
  const received=r.hash(),expected=await digest(t.desc);
  if(!expected.every((v,i)=>v===received[i]))err("schema SHA-256 mismatch");
  const value=readValue(r,t.type);
  if(r.i!==snapshot.length)err("trailing bytes");
  return value;
 }finally{
  // The caller owns the input bytes; only the decoder-owned snapshot is
  // destroyed, including malformed frames and asynchronous digest failures.
  snapshot.fill(0);
 }
}
// Validate the entire schema grammar synchronously at actor INIT. Length
// and ASCII checks alone would falsely acknowledge a malformed descriptor
// before the first DATA frame arrives. Both browser and Wasm hosts use the
// same bounded recursive shape parser.
export function validateActorMessageV2Contract({schemaId,descriptor}={}){
 schema(schemaId,descriptor);
 return true;
}
export const MESSAGEPACK_V2_LIMITS=Object.freeze({maxBytes:MAX_BYTES,maxNodes:MAX_NODES,maxDepth:MAX_DEPTH,maxDescriptorBytes:MAX_DESC});
