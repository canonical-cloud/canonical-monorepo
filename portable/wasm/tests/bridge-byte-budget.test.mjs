import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,truncate,readFile,rm} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compileOresToWasm} from "../scripts/compile-ores.mjs";

test("large sparse source and compiler are rejected before IR execution or artifact publication",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-bridge-budgets-"));
 try{
  const compiler=join(dir,"compiler.sh"),source=join(dir,"source.ores"),output=join(dir,"out.wasm");
  const original="#!/bin/sh\\nprintf 'define i64 @main() { ret i64 42 }\\n'\\n";
  await writeFile(compiler,original,{mode:0o700});
  await writeFile(source,"pub fnc main(): int { return 42; }\\n");
  await truncate(source,1024*1024+1);
  await assert.rejects(compileOresToWasm({compiler,source,output}),/source exceeds (configured byte budget|1 MiB compiler bridge budget)/);
  await writeFile(source,"pub fnc main(): int { return 42; }\\n");
  await truncate(compiler,256*1024*1024+1);
  await assert.rejects(compileOresToWasm({compiler,source,output}),/compiler exceeds (configured byte budget|256 MiB executable budget)/);
  for(const p of [output,output+".artifact.json",output+".provenance.json"])
   await assert.rejects(readFile(p),{code:"ENOENT"});
 }finally{await rm(dir,{recursive:true,force:true})}
});


test("special-file FIFO source and compiler refuse admission without blocking",{
 skip:process.platform==="win32"
},async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-bridge-special-files-"));
 try{
  const compiler=join(dir,"compiler.sh"),source=join(dir,"source.ores"),output=join(dir,"guest.wasm");
  const moduleUrl=new URL("../scripts/compile-ores.mjs",import.meta.url).href;
  for(const kind of ["source","compiler"]){
   await rm(source,{force:true});await rm(compiler,{force:true});
   if(kind==="source")await writeFile(compiler,"#!/bin/sh\nexit 0\n",{mode:0o700});
   else await writeFile(source,"pub fnc main(): int { return 42; }\n");
   const fifo=kind==="source"?source:compiler;
   const mkfifo=spawnSync("mkfifo",[fifo],{encoding:"utf8",timeout:2000});
   assert.equal(mkfifo.status,0,"mkfifo fixture failed: "+(mkfifo.stderr||mkfifo.error?.message));
   // Run the real bridge in a bounded child process: a regression to a
   // blocking open must fail promptly, not hang CI indefinitely.
   const script=[
    "import {compileOresToWasm} from "+JSON.stringify(moduleUrl)+";",
    "try { await compileOresToWasm("+JSON.stringify({compiler,source,output})+"); process.exitCode=12; }",
    "catch(e) { if(!/not a regular file|ELOOP|EAGAIN/.test(String(e.message))) process.exitCode=13;",
    'else console.log("SPECIAL_FILE_REJECTED"); }'
   ].join("\n");
   const attempt=spawnSync(process.execPath,["--input-type=module","-e",script],{
    encoding:"utf8",timeout:3000
   });
   assert.equal(attempt.error?.code,undefined,
    kind+" blocked during admission: "+attempt.error?.message);
   assert.equal(attempt.status,0,
    kind+" rejected incorrectly or failed to terminate: "+attempt.stderr+" "+attempt.stdout);
   assert.match(attempt.stdout,/SPECIAL_FILE_REJECTED/);
   for(const suffix of ["",".provenance.json",".artifact.json"])
    await assert.rejects(readFile(output+suffix),{code:"ENOENT"});
  }
 }finally{await rm(dir,{recursive:true,force:true})}
});
