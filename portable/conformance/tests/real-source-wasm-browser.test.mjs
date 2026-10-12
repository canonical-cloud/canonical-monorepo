import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const cli=fileURLToPath(new URL("../bin/real-source-wasm-browser.mjs",import.meta.url));
const h=b=>createHash("sha256").update(b).digest("hex");
const run=args=>spawnSync(process.execPath,[cli,...args],{encoding:"utf8"});
test("real source-to-browser gate requires every path, SHA pin and canonical i64",()=>{
 const r=run([]);
 assert.notEqual(r.status,0);assert.match(r.stderr,/absolute path/);
 const x=run(["--compiler=/tmp/fake","--compiler=/tmp/again"]);
 assert.notEqual(x.status,0);assert.match(x.stderr,/duplicate/);
 const y=run(["--unexpected=anything"]);
 assert.notEqual(y.status,0);assert.match(y.stderr,/unexpected/);
});
test("scripted and synthetic compiler stand-ins are rejected even with all hashes correct",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-native-source-gate-"));
 try{
  const compiler=join(dir,"compiler.sh"),source=join(dir,"guest.ores"),bridge=join(dir,"bridge.mjs"),
   adapter=join(dir,"adapter.mjs"),output=join(dir,"guest.wasm");
  const files=[
   [compiler,Buffer.from("#!/bin/sh\necho synthetic\n")],
   [source,Buffer.from("pub fnc main(): int { return 42; }\n")],
   [bridge,Buffer.from("console.log('fake')\n")],
   [adapter,Buffer.from("export function loadVerifiedCoreGuest(){}\n")]
  ];
  for(const [path,b] of files)await writeFile(path,b);
  const args=[
   "--compiler="+compiler,"--compiler-sha256="+h(files[0][1]),
   "--bridge="+bridge,"--bridge-sha256="+h(files[2][1]),
   "--source="+source,"--source-sha256="+h(files[1][1]),
   "--output="+output,
   "--browser-module="+adapter,"--browser-module-sha256="+h(files[3][1]),
   "--expected-i64=42"
  ];
  let v=run(args);assert.notEqual(v.status,0);assert.match(v.stderr,/native compiler executable required/);
  v=run(args.map(x=>x.startsWith("--source-sha256=")?"--source-sha256="+"0".repeat(64):x));
  assert.notEqual(v.status,0);assert.match(v.stderr,/source SHA-256/);
  v=run(args.map(x=>x.startsWith("--expected-i64=")?"--expected-i64=042":x));
  assert.notEqual(v.status,0);assert.match(v.stderr,/canonical signed 64-bit/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("mandatory real compiled Worker conformance cannot silently skip",()=>{
 const child=new URL("./real-compiled-worker.test.mjs",import.meta.url).pathname;
 // A nested node --test child inherits NODE_TEST_CONTEXT from its parent
 // runner; execute the test module directly in a fresh Node process instead.
 const env={...process.env,
  ORE_REQUIRE_REAL_WORKER:"1",ORE_REAL_WASM:"",
  ORE_REAL_MANIFEST:"",ORE_BROWSER_WORKER_HOST:"",ORE_BROWSER_WORKER_SHIM:""};
 delete env.NODE_TEST_CONTEXT;
 const result=spawnSync(process.execPath,[child],{encoding:"utf8",env});
 assert.notEqual(result.status,0,result.stdout+"\n"+result.stderr);
 assert.match(result.stderr+result.stdout,/required real compiled Oreslang Worker evidence is unconfigured/);
});

test("oversized pinned bridge is rejected before read/execute",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-native-budget-"));
 try{
  const compiler=join(dir,"compiler.bin"),source=join(dir,"guest.ores"),bridge=join(dir,"bridge.mjs"),
   adapter=join(dir,"adapter.mjs"),output=join(dir,"out.wasm");
  const {truncate}=await import("node:fs/promises");
  await writeFile(compiler,Buffer.from([0x7f,0x45,0x4c,0x46,1]));
  await writeFile(source,"pub fnc main(): int { return 42; }\n");
  await writeFile(bridge,"stub");
  await truncate(bridge,2*1024*1024+1);
  await writeFile(adapter,"export {}");
  const a=[
   "--compiler="+compiler,"--compiler-sha256="+"0".repeat(64),
   "--source="+source,"--source-sha256="+"0".repeat(64),
   "--bridge="+bridge,"--bridge-sha256="+"0".repeat(64),
   "--browser-module="+adapter,"--browser-module-sha256="+"0".repeat(64),
   "--output="+output,"--expected-i64=42"
  ];
  const r=run(a);
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/bridge exceeds native conformance input budget/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
