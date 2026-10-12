#!/usr/bin/env node
/** Offline, fail-closed admission for exact Git-blob CI mirrors.
 * Checks executed local files, not remote repository metadata or GitHub policy.
 */
import {readFile,lstat,realpath} from "node:fs/promises";
import {resolve,join,sep} from "node:path";
import {execFileSync} from "node:child_process";

const locations=new Map([
 ["portable/browser/","ores-truffle-oreslang/oreslang-browser"],
 ["portable/wasm/","ores-truffle-oreslang/oreslang-wasm"],
 ["portable/llvm/","ores-truffle-oreslang/oreslang-source.llvm"],
 ["portable/conformance/","ores-truffle-oreslang/oreslang-platform-conformance"]
]);
const sha=s=>typeof s==="string"&&/^[0-9a-f]{40}$/.test(s);
const reject=s=>{throw Error("native release source mirror: "+s)};
function positive(value,label){
 if(!/^[1-9][0-9]{0,3}$/.test(value||""))reject("invalid "+label);
 const x=Number(value);if(x>256)reject(label+" too large");return x
}
export async function verifyReleaseMirror({root,manifest,expectedFiles,expectedSources}){
 const resolved=await realpath(resolve(root));
 const mf=resolve(manifest);
 const st=await lstat(mf);
 if(!st.isFile()||st.size<2||st.size>1024*1024)reject("manifest byte budget");
 const x=JSON.parse(await readFile(mf,"utf8"));
 if(x.schemaVersion!==1||!Array.isArray(x.files)||!Array.isArray(x.sources)||
    x.files.length!==expectedFiles||x.sources.length!==expectedSources)
  reject("incomplete source manifest");
 const owned=new Map(),counts=new Map();
 for(const s of x.sources){
  if(!s||!Array.from(locations.values()).includes(s.repository)||
     owned.has(s.repository)||!sha(s.headCommit)||!sha(s.headTree)||
     !Number.isSafeInteger(s.count)||s.count<1)reject("invalid source pin");
  owned.set(s.repository,s);counts.set(s.repository,0);
 }
 const seen=new Set();
 for(const f of x.files){
  if(!f||typeof f.path!=="string"||!sha(f.blobSha)||
     !/^portable\/(?:browser|wasm|llvm|conformance)\/[a-zA-Z0-9._/-]+$/.test(f.path)||
     f.path.split("/").some(part=>part===".."||part==="."||part==="")||
     seen.has(f.path))reject("invalid or repeated mirror path");
  seen.add(f.path);
  const owner=Array.from(locations).find(([prefix])=>f.path.startsWith(prefix))?.[1];
  if(!owner||!owned.has(owner))reject("source origin unpinned");
  counts.set(owner,counts.get(owner)+1);
  const path=join(resolved,f.path);
  // Refuse directories, sparse giant inputs, symlinks AND symlinked parents:
  // the mirror must really be the tree we are about to execute.
  const meta=await lstat(path);
  if(!meta.isFile()||meta.size===0||meta.size>64*1024*1024)
   reject("invalid or oversized executed source file: "+f.path);
  if(await realpath(path)!==path)reject("mirror symlink/alias forbidden: "+f.path);
  const hash=execFileSync("git",["hash-object","--no-filters",f.path],{
   cwd:resolved,encoding:"utf8",timeout:10000,maxBuffer:4096
  }).trim();
  if(hash!==f.blobSha)reject("source Git blob mismatch: "+f.path);
 }
 for(const [repo,s] of owned)if(counts.get(repo)!==s.count)
  reject("source count mismatch for "+repo);
 return Object.freeze({ok:true,files:seen.size,sources:owned.size});
}
const called=process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname;
if(called){
 try{
  const options={};
  for(const arg of process.argv.slice(2)){
   const m=/^--(root|manifest|expected-files|expected-sources)=(.+)$/.exec(arg);
   if(!m||Object.hasOwn(options,m[1]))reject("unknown/duplicate option");
   options[m[1]]=m[2];
  }
  if(!options.root||!options.manifest)reject("root and manifest required");
  const r=await verifyReleaseMirror({
   root:options.root,manifest:options.manifest,
   expectedFiles:positive(options["expected-files"],"expected-files"),
   expectedSources:positive(options["expected-sources"],"expected-sources")
  });
  console.log(JSON.stringify(r));
 }catch(e){console.error(e.message);process.exitCode=1}
}
