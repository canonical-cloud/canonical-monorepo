import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,truncate,readFile,rm} from "node:fs/promises";
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
  await assert.rejects(compileOresToWasm({compiler,source,output}),/source exceeds configured byte budget/);
  await writeFile(source,"pub fnc main(): int { return 42; }\\n");
  await truncate(compiler,256*1024*1024+1);
  await assert.rejects(compileOresToWasm({compiler,source,output}),/compiler exceeds configured byte budget/);
  for(const p of [output,output+".artifact.json",output+".provenance.json"])
   await assert.rejects(readFile(p),{code:"ENOENT"});
 }finally{await rm(dir,{recursive:true,force:true})}
});
