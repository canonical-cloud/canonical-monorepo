/**
 * Transport-only worker endpoint: validates exact canonical MessagePack v2,
 * emits internal DATA receipts, honors a separate CONTROL drain channel.
 * Does not execute source-level Oreslang actor handlers.
 */
import {decodeActorMessageV2} from "./messagepack-v2.mjs";
let ready=false,closed=false,handling=false,stopPending=false,contract,lastTicket=0;
// Worker postMessage() snapshots into private destination memory. Never
// mutate caller-owned SharedArrayBuffer data when rejecting a malformed frame.
function scrubOwnedFrame(frame){
 if(!(frame instanceof Uint8Array))return;
 if(typeof SharedArrayBuffer!=="undefined"&&frame.buffer instanceof SharedArrayBuffer)return;
 try{frame.fill(0)}catch{}
}
self.addEventListener("message",async event=>{
 const data=event?.data;
 if(!data||typeof data!=="object")return panic();
 if(!ready){
  if(data.kind!=="oreslang-v2-init"||typeof data.schemaId!=="string"||
    typeof data.descriptor!=="string"){scrubOwnedFrame(data.frame);return panic()}
  contract={schemaId:data.schemaId,descriptor:data.descriptor};
  ready=true;
  self.postMessage({kind:"oreslang-v2-ready"});
  return;
 }
 if(closed){scrubOwnedFrame(data.frame);return}
 if(data.kind==="oreslang-v2-control"&&data.action==="drain"){
  stopPending=true;
  if(!handling){closed=true;self.postMessage({kind:"oreslang-v2-stopped"})}
  return;
 }
 if(data.kind!=="oreslang-v2-data"||!Number.isSafeInteger(data.id)||
   data.id<=lastTicket||handling||stopPending){
  // Malformed, replayed, or concurrent DATA still arrived as an owned
  // structured-clone buffer. Discard it before raising supervisor CONTROL.
  scrubOwnedFrame(data.frame);return panic();
 }
 // Admission gaps are permitted (failed serialization can consume an ID),
 // but a previously seen ticket can never be delivered or acknowledged twice.
 lastTicket=data.id;
 handling=true;
 try{
  // Decode owns a snapshot before WebCrypto. Never expose incoming mutable
  // frame bytes to an untrusted actor callback or reuse borrowed buffers.
  await decodeActorMessageV2({...contract,bytes:data.frame});
  self.postMessage({kind:"oreslang-v2-receipt",id:data.id,ok:true});
 }catch{panic();return}
 finally{
  // The decode procedure copies untrusted bytes before its crypto await;
  // wipe the Worker-owned input buffer on both acceptance and rejection.
  scrubOwnedFrame(data.frame);
  handling=false;
  if(stopPending&&!closed){closed=true;self.postMessage({kind:"oreslang-v2-stopped"})}
 }
});
function panic(){
 if(closed)return;closed=true;
 // No user-defined actor hook may intercept this terminal CONTROL failure.
 self.postMessage({kind:"oreslang-v2-panic"});
}
