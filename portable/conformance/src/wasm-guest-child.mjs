import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
const [wasmPath,manifestPath,browserModulePath,expected,expectedAdapterSha256]=process.argv.slice(2);
try{
 const adapterBytes=await readFile(browserModulePath);
 const browserModuleSha256=createHash("sha256").update(adapterBytes).digest("hex");
 if(browserModuleSha256!==expectedAdapterSha256)throw Error("browser adapter SHA-256 mismatch");
 // Exact entry-module bytes are checked here. Its relative imports still
 // require a separately verified and immutable whole Git source tree.
 const {loadVerifiedCoreGuest}=await import(pathToFileURL(browserModulePath).href);
 if(typeof loadVerifiedCoreGuest!=="function")throw Error("browser module missing verified guest loader");
 const [bytes,manifestText]=await Promise.all([readFile(wasmPath),readFile(manifestPath,"utf8")]);
 const manifest=JSON.parse(manifestText);
 const result=await loadVerifiedCoreGuest(bytes,manifest);
 const observed=result.entry();
 if(typeof observed!=="bigint"||observed.toString()!==expected)
  throw Error("expected i64 "+expected+"; received "+String(observed));
 console.log(JSON.stringify({ok:true,kind:"core-wasm-i64-guest-only",
  artifactSha256:manifest.wasmSha256,browserModuleSha256,entry:manifest.entry,
  expectedI64:expected,observedI64:observed.toString()}));
}catch(error){console.error(error.stack||error.message);process.exitCode=1}
