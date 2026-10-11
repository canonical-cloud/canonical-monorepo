import test from "node:test";
import assert from "node:assert/strict";
import {encodeActorMessageV2 as encode,decodeActorMessageV2 as decode} from "../transport/messagepack-v2.mjs";
const vectors=[
 ["demo.TupleBoolString.v1","T[B,S]",[true,"foo"],"9402b764656d6f2e5475706c65426f6f6c537472696e672e7631c420d254b4ecd3d7964454dcdf86fd10ede585a17b3af27982a289819afdc2379ab292c3a3666f6f"],
 ["demo.FixedArrayInts.v1","FA[I,I,I]",[1n,2n,3n],"9402b664656d6f2e46697865644172726179496e74732e7631c4206a46f6c65c619cc1c5354f7bd3b35ec0fcfbc9866c0760a15b860cfef79773b993010203"],
 ["demo.FixedListNested.v1","FL[L[S],B]",[["a","b"],false],"9402b764656d6f2e46697865644c6973744e65737465642e7631c4202007a0279d88d3eca7d21cf32b37327b996593c1353963dd78555f56f1ba6ddc9292a161a162c2"],
 ["demo.ArrayStrings.v1","A[S]",["a","b"],"9402b464656d6f2e4172726179537472696e67732e7631c420139722a10b9ef4d4af0cea1bfbc50ff92a0459aabf837f63a6fec052fe5dc5c992a161a162"],
 ["demo.ListStrings.v1","L[S]",["a","b"],"9402b364656d6f2e4c697374537472696e67732e7631c4204efbea59591d5c31d9f13ee93ef5c1d954e653144d380bb2d064ea4fa6d56b8c92a161a162"],
 ["demo.String.v1","S","foo","9402ae64656d6f2e537472696e672e7631c42021c2efdbff08dd4e1320d8abe1ba0cc6aea8e4cf104b984be7b7079968fad3cda3666f6f"]
];
const config=(id,desc,value)=>({schemaId:id,descriptor:desc,value});
test("all six canonical Java/LLVM golden frames roundtrip byte for byte",async()=>{
 for(const [id,desc,value,hex] of vectors){
  const result=await encode(config(id,desc,value));
  assert.equal(Buffer.from(result).toString("hex"),hex,id);
  assert.deepEqual(await decode({schemaId:id,descriptor:desc,bytes:result}),value);
  assert.deepEqual(await decode({schemaId:id,descriptor:desc,bytes:Buffer.from(hex,"hex")}),value);
 }
});
test("wide signed i64 remains precise and floating payloads reject NaN",async()=>{
 for(const n of [-(1n<<63n),-129n,-33n,-32n,-1n,0n,127n,128n,256n,(1n<<63n)-1n]){
  const id="case#variant=1",desc="I",bytes=await encode(config(id,desc,n));
  assert.equal(await decode({schemaId:id,descriptor:desc,bytes}),n);
 }
 for(const n of [NaN,Infinity,-Infinity])await assert.rejects(encode(config("demo.Float","F",n)),/finite/);
 assert.equal(await decode({schemaId:"demo.Float",descriptor:"F",bytes:await encode(config("demo.Float","F",-0))}),-0);
});
test("schema, version, hash, UTF-8 and trailing bytes fail closed",async()=>{
 const [id,desc,value]=vectors[5],original=await encode(config(id,desc,value));
 const corrupted=original.slice();corrupted[20]^=1;
 await assert.rejects(decode({schemaId:id,descriptor:desc,bytes:corrupted}),/SHA-256/);
 await assert.rejects(decode({schemaId:id,descriptor:"I",bytes:original}),/SHA-256/);
 await assert.rejects(decode({schemaId:"demo.Other",descriptor:desc,bytes:original}),/schema ID/);
 const badVersion=original.slice();badVersion[1]=1;
 await assert.rejects(decode({schemaId:id,descriptor:desc,bytes:badVersion}),/version/);
 await assert.rejects(decode({schemaId:id,descriptor:desc,bytes:Uint8Array.from([...original,0])}),/trailing/);
 const badUtf8=original.slice();badUtf8[badUtf8.length-1]=255;
 await assert.rejects(decode({schemaId:id,descriptor:desc,bytes:badUtf8}),/UTF-8/);
});
test("payload is copied before asynchronous digest and shared memory is rejected",async()=>{
 const [id,desc,value]=vectors[5],b=await encode(config(id,desc,value));
 const pending=decode({schemaId:id,descriptor:desc,bytes:b});
 b.fill(0);assert.equal(await pending,value);
 if(typeof SharedArrayBuffer!=="undefined"){
  const shared=new Uint8Array(new SharedArrayBuffer(80));
  await assert.rejects(decode({schemaId:id,descriptor:desc,bytes:shared}),/shared memory/);
 }
});
test("noncanonical MessagePack headers and malformed structures reject",async()=>{
 const original=await encode(config("demo.Int","I",1n));
 const wrong=Uint8Array.from([...original.subarray(0,-1),0xcc,1]);
 await assert.rejects(decode({schemaId:"demo.Int",descriptor:"I",bytes:wrong}),/noncanonical/);
 const zero=await encode(config("demo.Bool","B",true));zero[zero.length-1]=0xc0;
 await assert.rejects(decode({schemaId:"demo.Bool",descriptor:"B",bytes:zero}),/bool/);
 await assert.rejects(encode(config("demo.Bad","A[I]",Array(100001).fill(0n))),/sequence length budget/);
 await assert.rejects(encode(config("demo.Bad","T[I,]",[1n])),/shape/);
 await assert.rejects(encode(config("demo.Bad","I",1)),/BigInt/);
});

test("untrusted oversized frames are rejected before owned snapshot allocation",async()=>{
 const b=new Uint8Array(2*1024*1024);
 await assert.rejects(
  decode({schemaId:"demo.String.v1",descriptor:"S",bytes:b,maxBytes:128}),
  /frame byte budget/);
 const view=b.subarray(1,1024*1024+2);
 await assert.rejects(
  decode({schemaId:"demo.String.v1",descriptor:"S",bytes:view,maxBytes:1024*1024}),
  /frame byte budget/);
});

// Regression: the temporary UTF-8 allocation is itself bounded, not just the
// eventual encoded MessagePack frame.
test("oversized UTF-8 payloads fail before TextEncoder allocates them",async()=>{
 const original=TextEncoder.prototype.encode;
 let oversizedEncodes=0;
 TextEncoder.prototype.encode=function(input){
  if(typeof input==="string"&&input.length>10000)oversizedEncodes++;
  return original.call(this,input);
 };
 try{
  for(const value of ["x".repeat(200000),"🌐".repeat(200000),"é".repeat(200000)]){
   await assert.rejects(encode({...config("oversize","S",value),maxBytes:64}),/frame byte budget/);
  }
  assert.equal(oversizedEncodes,0,"large temporary TextEncoder allocation");
 }finally{TextEncoder.prototype.encode=original}
});
