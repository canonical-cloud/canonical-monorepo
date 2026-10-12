/**
 * Experimental host-side, bounded actor DATA transport over a real dedicated
 * Worker. This is NOT guest Oreslang actor code, a scheduler or compiler lowering.
 * Internal delivery receipts are distinct from user-visible send acknowledgments.
 */
import {encodeActorMessageV2} from "./messagepack-v2.mjs";
const fail=s=>{throw new Error("Oreslang actor transport: "+s)};
export function createActorMessageTransport({
 schemaId,descriptor,capacity=16,timeoutMs=5000,workerFactory,onSupervisorPanic,
 maxFrameBytes=1048576,maxReservedBytes=4194304
}={}){
 // INIT is posted before DATA reservation; bound metadata separately so a
 // caller cannot allocate/clone arbitrarily large strings outside quotas.
 if(typeof schemaId!=="string"||typeof descriptor!=="string"||
    schemaId.length===0||descriptor.length===0||
    schemaId.length>512||descriptor.length>4096||
    new TextEncoder().encode(schemaId).length>512||
    new TextEncoder().encode(descriptor).length>4096)
  fail("invalid schema or descriptor byte budget");
 if(!Number.isSafeInteger(capacity)||capacity<1||capacity>4096)fail("invalid capacity");
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail("invalid deadline");
 if(!Number.isSafeInteger(maxFrameBytes)||maxFrameBytes<64||maxFrameBytes>1048576)fail("invalid frame byte budget");
 if(!Number.isSafeInteger(maxReservedBytes)||maxReservedBytes<maxFrameBytes||maxReservedBytes>67108864)
  fail("invalid total reserved byte budget");
 const create=workerFactory||(()=>{
  if(typeof Worker!=="function")fail("dedicated Web Worker unavailable");
  return new Worker(new URL("./actor-message-worker.mjs",import.meta.url),{type:"module"});
 });
 const worker=create();
 if(!worker||["postMessage","addEventListener","removeEventListener","terminate"].some(x=>typeof worker[x]!=="function")){
  // A broken factory may already have allocated a live OS Worker before
  // returning an incomplete adapter. Revoke it rather than leaking a carrier.
  try{const termination=worker?.terminate?.();termination?.catch?.(()=>{})}catch{}
  fail("trusted dedicated Worker required");
 }
 let pending=0,ready=false,active=null,sealed=false,stopping=false,finished=false,seq=0,deadline;
 let pumping=false,repump=false,terminalError=null;
 const queue=[];
 let doneResolve,doneReject;
 const done=new Promise((resolve,reject)=>{doneResolve=resolve;doneReject=reject});
 // The completion promise may reject before the user requests get_done().
 // Suppress process-level unhandled rejection while retaining its rejection.
 done.catch(()=>{});
 const clear=()=>{if(deadline!==undefined){clearTimeout(deadline);deadline=undefined}};
 const arm=()=>{if(finished)return;clear();deadline=setTimeout(()=>fatal(Error("isolated actor Worker deadline exceeded")),timeoutMs)};
 const cleanup=()=>{
  clear();
  for(const [kind,cb] of [["message",onMessage],["error",onError],["messageerror",onError],["exit",onExit]])
   try{worker.removeEventListener(kind,cb)}catch{}
  try{const x=worker.terminate();if(x&&typeof x.catch==="function")x.catch(()=>{})}catch{}
 };
 const complete=(error,notifySupervisor=true)=>{
  if(finished)return;
  finished=true;sealed=true;terminalError=error||null;
  // Cancel every pending serializer immediately; no rejected actor may leave
  // unresolved admission futures waiting on untrusted crypto providers.
  for(const item of queue){
   item.abort?.(error||Error("actor stopped"));
   item.frame?.fill(0);
   item.frame=null;
  }
  queue.length=0;
  // The active frame belongs to this mailbox until an internal delivery
  // receipt; cancellation/panic must scrub it, too.
  active?.frame?.fill(0);
  active=null;pending=0;
  cleanup();
  if(error){if(notifySupervisor)try{onSupervisorPanic?.({type:"ACTOR_TRANSPORT_FAILURE",reason:String(error.message||error)})}catch{}doneReject(error)}
  else doneResolve();
 };
 const fatal=error=>complete(error instanceof Error?error:Error("isolated actor Worker failed"));
 const onError=()=>fatal(Error("isolated actor Worker failed"));
 // A native worker_threads adapter may surface exit without first delivering
 // an error event. Browser Workers do not standardize "exit"; registration
 // is optional there, but supported native adapters fail promptly.
 const onExit=()=>fatal(Error("isolated actor Worker exited unexpectedly"));
 // Synchronous Worker adapters may deliver a receipt directly inside
 // postMessage(). Trampoline the next mailbox turn rather than recursively
 // entering pump() for every message (a capacity-sized stack overflow).
 function pump(){
  if(pumping){repump=true;return}
  pumping=true;
  try{
   do{
    repump=false;
    if(finished||!ready||active!==null)break;
    if(queue.length){
     // Sends reserve FIFO tickets before hashing. A later completed digest
     // must not overtake an earlier pending admission.
     if(queue[0].frame===null)break;
     const item=queue.shift();active=item;
     item.dispatched=true;
     try{
      worker.postMessage({kind:"oreslang-v2-data",id:item.id,frame:item.frame});
      if(active===item&&!finished)arm();
     }catch{fatal(Error("actor DATA transport failure"))}
    }else if(sealed&&pending===0&&!stopping){
     stopping=true;
     try{
      worker.postMessage({kind:"oreslang-v2-control",action:"drain"});
      if(!finished)arm();
     }catch{fatal(Error("actor CONTROL transport failure"))}
    }
   }while(repump&&!finished);
  }finally{pumping=false}
 }
 const onMessage=event=>{
  if(finished)return;
  const m=event?.data;
  if(!m||typeof m!=="object")return fatal(Error("invalid actor worker message"));
  if(m.kind==="oreslang-v2-panic")
   return fatal(Error("isolated actor Worker reported panic"));
  if(m.kind==="oreslang-v2-ready"&&!ready&&!stopping){ready=true;clear();pump();return}
  if(m.kind==="oreslang-v2-receipt"&&ready&&active!==null&&
    m.id===active.id&&m.ok===true){
   clear();
   // Worker postMessage uses structured clone (no transfer list). The host
   // must not retain a second copy of a processed DATA frame.
   active.frame?.fill(0);
   active.frame=null;active=null;pending--;pump();return
  }
  if(m.kind==="oreslang-v2-stopped"&&stopping&&active===null&&pending===0){complete();return}
  fatal(Error("invalid actor worker lifecycle or receipt"));
 };
 try{
  worker.addEventListener("message",onMessage);
  worker.addEventListener("error",onError);
  worker.addEventListener("messageerror",onError);
  try{worker.addEventListener("exit",onExit)}catch{}
  worker.postMessage({kind:"oreslang-v2-init",schemaId,descriptor});
  if(!ready&&!finished)arm();
 }catch{
  // Even a partially registered custom Worker adapter must never leak its
  // carrier thread after failing initialization.
  fatal(Error("actor Worker initialization failed"));
 }
 return Object.freeze({
  async send(value){
   if(sealed||finished)fail("mailbox closed");
   // Budget pessimistically reserves the whole maximum encoded frame BEFORE
   // hashing, including the active turn and every queued/preparing message.
   // Bounded-count mailboxes alone allow capacity * 1MiB memory exhaustion.
   if(pending>=capacity||(pending+1)*maxFrameBytes>maxReservedBytes)
    fail("mailbox full (count or reserved byte budget)");
   pending++;
   const item={id:++seq,frame:null,abort:null,dispatched:false};
   queue.push(item);
   let timer;
   const cancelled=new Promise((_,reject)=>{item.abort=reject});
   try{
    const admissionDeadline=new Promise((_,reject)=>{
     timer=setTimeout(()=>{
      const err=Error("actor DATA admission deadline exceeded");
      fatal(err);reject(err);
     },timeoutMs);
    });
    // The encode promise can finish after stop() already rejected the
    // admission race. Scrub that late owned frame rather than abandoning it.
    const encoding=encodeActorMessageV2({schemaId,descriptor,value,maxBytes:maxFrameBytes})
     .then(frame=>{if(finished)frame.fill(0);return frame});
    const frame=await Promise.race([encoding,cancelled,admissionDeadline]);
    if(finished)fail("actor stopped during message admission");
    item.frame=frame;
    pump();
    // A synchronously acknowledging Worker may complete drain() inside
    // pump(). This DATA was already admitted and delivered; only terminal
    // transport failure (or failure to dispatch) invalidates admission.
    if(finished&&(terminalError||!item.dispatched))
     fail("worker rejected message admission");
    return true; // admitted, not necessarily processed
   }catch(error){
    if(!finished){
     pending--;const pos=queue.indexOf(item);if(pos>=0)queue.splice(pos,1);
     item.frame?.fill(0);item.frame=null;
    }
    pump();throw error
   }finally{
    clearTimeout(timer);item.abort=null;
   }
  },
  drain(){sealed=true;pump();return done},
  stop(){complete(Error("actor cancelled"),false);return done},
  get_done(){return done},
  get pending(){return pending},
  get sealed(){return sealed}
 });
}
