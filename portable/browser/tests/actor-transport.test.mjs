import test from "node:test";
import assert from "node:assert/strict";
import {Worker} from "node:worker_threads";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {createActorMessageTransport} from "../src/actor-transport.mjs";
const spec={schemaId:"example.Compute#variant=1",descriptor:"T[S,I]"};
function workerFactory(){
 const worker=new Worker(new URL("./fixtures/actor-node-worker-shim.mjs",import.meta.url),{type:"module"});
 const map=new Map();
 return {
  addEventListener(kind,cb){const handler=kind==="message"?data=>cb({data}):()=>cb({});map.set(cb,{kind,handler});worker.on(kind,handler)},
  removeEventListener(kind,cb){const v=map.get(cb);if(v){worker.off(v.kind,v.handler);map.delete(cb)}},
  postMessage(data){worker.postMessage(data)},
  terminate(){return worker.terminate()}
 };
}
test("browser codec is byte-identical to canonical upstream Wasm codec",async()=>{
 const b=await readFile(new URL("../src/messagepack-v2.mjs",import.meta.url));
 const header=Buffer.from("blob "+b.length+"\0","utf8");
 assert.equal(createHash("sha1").update(header).update(b).digest("hex"),
  "6f12cfc99a2bb375a600123e339fe8e6a72a83fb");
});
test("isolated Worker processes bounded canonical actor DATA; drain seals mailbox",async()=>{
 const actor=createActorMessageTransport({...spec,workerFactory,capacity:3});
 assert.equal(await actor.send(["hello",42n]),true);
 assert.equal(await actor.send(["second",-(1n<<63n)]),true);
 const drained=actor.drain();
 await assert.rejects(actor.send(["late",1n]),/mailbox closed/);
 await drained;
 assert.equal(actor.pending,0);
 assert.equal(actor.sealed,true);
 await actor.get_done();
});
test("mailbox reserves full capacity before async hashing and rejects overload",async()=>{
 const worker=()=>({addEventListener(){},removeEventListener(){},postMessage(){},terminate(){}});
 let supervisorPanic=0;
 const a=createActorMessageTransport({...spec,workerFactory:worker,capacity:1,timeoutMs:500,
  onSupervisorPanic(){supervisorPanic++}});
 const first=a.send(["first",1n]);
 await assert.rejects(a.send(["too many",2n]),/mailbox full/);
 await first; // admission can succeed before runtime has acknowledged readiness
 await assert.rejects(a.stop(),/cancelled/);
 assert.equal(a.sealed,true);
 assert.equal(supervisorPanic,0);
});
test("malformed data is denied before admission without leaking queue capacity",async()=>{
 const a=createActorMessageTransport({...spec,workerFactory,capacity:1});
 await assert.rejects(a.send(["wrong",5]),/BigInt/);
 assert.equal(a.pending,0);
 assert.equal(await a.send(["valid",5n]),true);
 await a.drain();
});
test("forged worker receipt triggers supervisor CONTROL failure",async()=>{
 let cb,reported=0,terminated=false;
 const workerFactory=()=>({
  addEventListener(kind,fn){if(kind==="message")cb=fn},
  removeEventListener(){},
  postMessage(msg){if(msg.kind==="oreslang-v2-init")queueMicrotask(()=>cb({data:{kind:"oreslang-v2-ready"}}));
   if(msg.kind==="oreslang-v2-data")queueMicrotask(()=>cb({data:{kind:"oreslang-v2-receipt",id:99999,ok:true}}))},
  terminate(){terminated=true}
 });
 const a=createActorMessageTransport({...spec,workerFactory,onSupervisorPanic(){reported++}});
 assert.equal(await a.send(["hello",1n]),true);
 await assert.rejects(a.get_done(),/invalid actor worker lifecycle/);
 assert.equal(reported,1);
 assert.equal(terminated,true);
});

test("byte-budget reservations bound concurrent DATA even when slot count is high",async()=>{
 const factory=()=>({
  addEventListener(){},removeEventListener(){},postMessage(){},terminate(){}
 });
 const actor=createActorMessageTransport({...spec,capacity:100,
  maxFrameBytes:1048576,maxReservedBytes:1048576,workerFactory:factory});
 const first=actor.send(["held",1n]);
 await assert.rejects(actor.send(["also-held",2n]),/mailbox full/);
 await first;
 assert.equal(actor.pending,1);
 await assert.rejects(actor.stop(),/cancelled/);
});
test("stop promptly rejects pending admission, never claiming acceptance",async()=>{
 const factory=()=>({
  addEventListener(){},removeEventListener(){},postMessage(){},terminate(){}
 });
 const actor=createActorMessageTransport({...spec,workerFactory:factory,timeoutMs:2000});
 const inFlight=actor.send(["pending",7n]);
 const complete=actor.stop();
 await assert.rejects(inFlight,/cancelled|stopped/);
 await assert.rejects(complete,/cancelled/);
 assert.equal(actor.pending,0);
});
test("invalid frame and total-byte budgets fail before starting a Worker",()=>{
 let created=false;
 const factory=()=>{created=true;throw Error("unexpected worker allocation")};
 for(const options of [
  {maxFrameBytes:63},{maxFrameBytes:1048577},
  {maxFrameBytes:1024,maxReservedBytes:1023},
  {maxFrameBytes:1024,maxReservedBytes:67108865}
 ]){
  assert.throws(()=>createActorMessageTransport({...spec,workerFactory:factory,...options}),/budget/);
 }
 assert.equal(created,false);
});
test("admission protocol delivers immutable FIFO tickets across concurrent sends",async()=>{
 const seen=[];
 let onMessage;
 const factory=()=>({
  addEventListener(k,cb){if(k==="message")onMessage=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-v2-init")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-v2-ready"}}));
   if(msg.kind==="oreslang-v2-data"){
    seen.push(msg.id);
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-v2-receipt",id:msg.id,ok:true}}));
   }
   if(msg.kind==="oreslang-v2-control")
    queueMicrotask(()=>onMessage({data:{kind:"oreslang-v2-stopped"}}));
  },
  terminate(){}
 });
 const actor=createActorMessageTransport({...spec,workerFactory:factory,capacity:4});
 const first=actor.send(["one",1n]),second=actor.send(["two",2n]),third=actor.send(["three",3n]);
 await Promise.all([first,second,third]);
 await actor.drain();
 assert.deepEqual(seen,[1,2,3]);
});

test("oversized Unicode DATA admission fails closed and releases its reserved slot",async()=>{
 const factory=()=>({addEventListener(){},removeEventListener(){},postMessage(){},terminate(){}});
 const actor=createActorMessageTransport({...spec,workerFactory:factory,capacity:1,maxFrameBytes:128});
 await assert.rejects(actor.send(["🌐".repeat(200000),1n]),/frame byte budget/);
 assert.equal(actor.pending,0);
 await assert.rejects(actor.stop(),/cancelled/);
});

test("invalid Worker factory adapters terminate already allocated carriers",()=>{
 let terminated=0;
 const factory=()=>({
  postMessage(){},addEventListener(){},
  // Deliberately missing removeEventListener; a worker was still allocated.
  terminate(){terminated++;return Promise.resolve()}
 });
 assert.throws(()=>createActorMessageTransport({...spec,workerFactory:factory}),/trusted dedicated Worker required/);
 assert.equal(terminated,1);
});

test("DATA frame is scrubbed after internal receipt without losing FIFO delivery",async()=>{
 let receive,frame,delivered;
 const factory=()=>({
  addEventListener(kind,cb){if(kind==="message")receive=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-v2-init")
    queueMicrotask(()=>receive({data:{kind:"oreslang-v2-ready"}}));
   if(msg.kind==="oreslang-v2-data"){
    frame=msg.frame;
    delivered=Uint8Array.from(frame);
    queueMicrotask(()=>receive({data:{kind:"oreslang-v2-receipt",id:msg.id,ok:true}}));
   }
   if(msg.kind==="oreslang-v2-control")
    queueMicrotask(()=>receive({data:{kind:"oreslang-v2-stopped"}}));
  },terminate(){}
 });
 const actor=createActorMessageTransport({...spec,workerFactory:factory});
 await actor.send(["scrub-me",42n]);
 await actor.drain();
 assert.ok(delivered?.some(x=>x!==0),"Worker received nonempty canonical frame");
 assert.ok(frame?.every(x=>x===0),"host must scrub acknowledged frame");
 assert.equal(actor.pending,0);
});

test("cancel scrubs active DATA frame and does not report supervisor panic",async()=>{
 let receive,frame,reported=0;
 const factory=()=>({
  addEventListener(kind,cb){if(kind==="message")receive=cb},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-v2-init")
    queueMicrotask(()=>receive({data:{kind:"oreslang-v2-ready"}}));
   if(msg.kind==="oreslang-v2-data")frame=msg.frame;
  },terminate(){}
 });
 const actor=createActorMessageTransport({...spec,workerFactory:factory,
  onSupervisorPanic(){reported++}});
 await actor.send(["scrub-on-stop",8n]);
 // The ready callback has been delivered and DATA has been dispatched.
 assert.ok(frame?.some(x=>x!==0),"test observed active frame before stop");
 await assert.rejects(actor.stop(),/cancelled/);
 assert.ok(frame.every(x=>x===0),"active frame zeroized at teardown");
 assert.equal(actor.pending,0);
 assert.equal(reported,0);
});

test("synchronous Worker receipts and drain completion do not create a stale deadline",async()=>{
 let cb,term=0;
 const factory=()=>({
  addEventListener(kind,fn){if(kind==="message")cb=fn},
  removeEventListener(){},
  postMessage(msg){
   if(msg.kind==="oreslang-v2-init")cb({data:{kind:"oreslang-v2-ready"}});
   if(msg.kind==="oreslang-v2-data")
    cb({data:{kind:"oreslang-v2-receipt",id:msg.id,ok:true}});
   if(msg.kind==="oreslang-v2-control")
    cb({data:{kind:"oreslang-v2-stopped"}});
  },
  terminate(){term++}
 });
 const actor=createActorMessageTransport({...spec,workerFactory:factory,timeoutMs:20});
 await actor.send(["sync",1n]);
 await actor.drain();
 assert.equal(actor.pending,0);
 assert.equal(term,1);
 await new Promise(resolve=>setTimeout(resolve,35));
 await actor.get_done();
});
