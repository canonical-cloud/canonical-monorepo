import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {resolve,dirname,isAbsolute} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
function validSha(s){return typeof s==="string" && /^[0-9a-f]{40}$/.test(s)}
export function validateCommand(argv){
 if(!Array.isArray(argv)||argv.length===0||argv.some(x=>typeof x!=="string"||!x||x.includes("\0")))throw Error("compiler argv must be nonempty strings without NUL");
 if(!isAbsolute(argv[0]))throw Error("compiler executable path must be absolute (no PATH lookup)");
 if(argv.filter(x=>x.includes("{file}")).length!==1 || argv.some(x=>x.includes("{file}")&&x!=="{file}"))
  throw Error("exactly one standalone {file} positional token is required");
 return argv;
}
export async function loadManifest(){
 const manifest=JSON.parse(await readFile(resolve(root,"fixtures/manifest.json"),"utf8"));
 if(manifest.schemaVersion!==1||!Array.isArray(manifest.cases))throw Error("invalid manifest schema");
 const ids=new Set();
 for(const item of manifest.cases){
  if(!item||typeof item.id!=="string"||ids.has(item.id)||!/^[a-z0-9-]+$/.test(item.id))throw Error("invalid/duplicate test id");
  ids.add(item.id);
  if(typeof item.file!=="string"||!/^[-a-z0-9]+\.ores$/.test(item.file))throw Error("invalid fixture path");
  if(!["accept","reject"].includes(item.expect)||!Array.isArray(item.backends)||!item.backends.length||item.backends.some(x=>!["java","llvm","wasm","browser"].includes(x)))throw Error("invalid fixture expectation/backends");
  if(item.expect==="reject"&&typeof item.diagnostic!=="string")throw Error("negative fixture must require a diagnostic");
  await readFile(resolve(root,"fixtures",item.file),"utf8");
 }
 return manifest;
}
export async function runSuite({backend,argv,sourceSha,timeoutMs=10000,requireConfigured=false,spawn=spawnSync}={}){
 if(!["java","llvm","wasm","browser"].includes(backend))throw Error("unknown backend");
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw Error("timeoutMs must be 100..120000");
 const manifest=await loadManifest();
 const relevant=manifest.cases.filter(x=>x.backends.includes(backend));
 if(!argv){
  return {backend,sourceSha:sourceSha||null,configured:false,verified:0,failed:0,
   skipped:relevant.length,ok:!requireConfigured,results:relevant.map(c=>({id:c.id,status:"UNCONFIGURED"}))};
 }
 validateCommand(argv);
 if(!validSha(sourceSha))throw Error("configured backend requires exact 40-character lowercase source commit SHA");
 let executableSha256=null;
 try{const binaryBytes=await readFile(argv[0]);executableSha256=createHash("sha256").update(binaryBytes).digest("hex")}
 catch{/* absent executable is reported as SPAWN_ERROR for each fixture below */}
 const results=[];
 for(const c of relevant){
  const fixturePath=resolve(root,"fixtures",c.file);
  const fixtureSha256=createHash("sha256").update(await readFile(fixturePath)).digest("hex");
  const cmd=argv.map(x=>x==="{file}"?fixturePath:x);
  const output=spawn(cmd[0],cmd.slice(1),{encoding:"utf8",timeout:timeoutMs,cwd:root,maxBuffer:1024*1024,windowsHide:true});
  let status;
  const combined=(output.stdout||"")+"\n"+(output.stderr||"");
  if(output.error)status=output.error.code==="ETIMEDOUT"?"TIMEOUT":"SPAWN_ERROR";
  else if(output.signal)status="SIGNALED";
  else if(c.expect==="accept")status=output.status===0?"VERIFIED":"MISMATCH";
  else {
   const match=new RegExp(c.diagnostic,"i").test(combined);
   const diagnostic=/(?:\berror\b|\bundefined\b|\bundeclared\b|\bunknown\b|\bunresolved\b|not found|cannot find)/i.test(combined);
   status=output.status!==0 && diagnostic && match?"VERIFIED":"MISMATCH";
  }
  results.push({id:c.id,status,fixtureSha256,exitCode:output.status,signal:output.signal||null,
    stdout:output.stdout||"",stderr:output.stderr||""});
 }
 const verified=results.filter(x=>x.status==="VERIFIED").length;
 const failed=results.filter(x=>x.status!=="VERIFIED").length;
 return {backend,declaredSourceSha:sourceSha,executableSha256,provenanceNote:"Source revision was supplied by caller; this harness does not attest that it produced the binary.",configured:true,verified,failed,skipped:0,ok:failed===0 && verified>0,results};
}
