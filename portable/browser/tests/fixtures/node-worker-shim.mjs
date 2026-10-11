import {parentPort} from "node:worker_threads";
// Node worker_threads shim for exercising the unmodified browser Worker entry.
// This is real isolated Node Worker execution, NOT proof of a browser engine.
globalThis.self={
 addEventListener(kind,cb){if(kind==="message")parentPort.on("message",data=>cb({data}));},
 postMessage(data){parentPort.postMessage(data)}
};
await import("../../src/guest-worker.mjs");
