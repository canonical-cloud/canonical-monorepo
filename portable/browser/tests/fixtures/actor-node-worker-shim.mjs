import {parentPort} from "node:worker_threads";
globalThis.self={
 addEventListener(kind,callback){if(kind==="message")parentPort.on("message",data=>callback({data}))},
 postMessage(data){parentPort.postMessage(data)}
};
await import("../../src/actor-message-worker.mjs");
