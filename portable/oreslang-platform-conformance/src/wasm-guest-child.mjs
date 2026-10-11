import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
const [wasmPath,manifestPath,browserModulePath,expected]=process.argv.slice(2);
try{
 const {loadVerifiedCoreGuest}=await import(pathToFileURL(browserModulePath).href);
 if(typeof loadVerifiedCoreGuest!=="function")throw Error("browser module missing verified guest loader");
 const [bytes,manifestText]=await Promise.all([readFile(wasmPath),readFile(manifestPath,"utf8")]);
 const manifest=JSON.parse(manifestText);
 const result=await loadVerifiedCoreGuest(bytes,manifest);
 const observed=result.entry();
 if(typeof observed!=="bigint"||observed.toString()!==expected)
  throw Error("expected i64 "+expected+"; received "+String(observed));
 console.log(JSON.stringify({ok:true,kind:"core-wasm-i64-guest-only",
  artifactSha256:manifest.wasmSha256,entry:manifest.entry,
  expectedI64:expected,observedI64:observed.toString()}));
}catch(error){console.error(error.stack||error.message);process.exitCode=1}
