import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,chmod,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {compileOresToWasm} from "../scripts/compile-ores.mjs";

const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
test("compiler consumes hashed source snapshot even if original changes during execution",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-wasm-source-snapshot-"));
 try{
  const source=join(dir,"guest.ores"),compiler=join(dir,"compiler.mjs"),output=join(dir,"guest.wasm");
  const initial="pub fnc main(): int { return 42; }\n";
  await writeFile(source,initial);
  // The fake compiler checks both that its executable is a pinned staged copy
  // and that its source is the staged snapshot, not caller-owned paths. It must
  // see a copied immutable source path, not the file it intentionally changes.
  const script=[
   "#!/usr/bin/env node",
   'import {readFileSync,writeFileSync} from "node:fs";',
   "const original="+JSON.stringify(source)+";",
   "const originalCompiler="+JSON.stringify(compiler)+";",
   'if(process.argv[1]===originalCompiler)process.exit(24);',
   'writeFileSync(original,"pub fnc main(): int { return 999; }\\n");',
   'const compiledPath=process.argv.at(-1);',
   'if(compiledPath===original)process.exit(20);',
   'if(readFileSync(compiledPath,"utf8")!=="pub fnc main(): int { return 42; }\\n")process.exit(21);',
   'process.stdout.write("target triple = \\"wasm32-unknown-unknown\\"\\ndefine i64 @main() { ret i64 42 }\\n");',
   ""
  ].join("\n");
  await writeFile(compiler,script,{mode:0o700});await chmod(compiler,0o700);
  const record=await compileOresToWasm({compiler,source,output,environment:"browser"});
  const wasm=await readFile(output),metadata=JSON.parse(await readFile(output+".artifact.json","utf8"));
  assert.equal(record.sourceSha256,sha(Buffer.from(initial)));
  assert.equal(metadata.producer.sourceSha256,record.sourceSha256);
  assert.notEqual(sha(await readFile(source)),record.sourceSha256);
  assert.equal((new WebAssembly.Instance(new WebAssembly.Module(wasm))).exports.main(),42n);
 }finally{await rm(dir,{recursive:true,force:true})}
});


test("artifact paths cannot clobber source inputs or compiler executable",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-wasm-path-alias-"));
 try{
  const compiler=join(dir,"compiler"),out=join(dir,"guest.wasm"),source=join(dir,"source.ores");
  const original="pub fnc main(): int { return 42; }\n";
  await writeFile(compiler,"not executable");await writeFile(source,original);
  for(const destination of [source,compiler]){
   await assert.rejects(compileOresToWasm({compiler,source,output:destination}),
    /overlaps a compiler\/source input/);
  }
  assert.equal(await readFile(source,"utf8"),original);
  assert.equal(await readFile(compiler,"utf8"),"not executable");
  for(const suffix of [".artifact.json",".provenance.json"]){
   const metadataSource=out+suffix;
   await writeFile(metadataSource,original);
   await assert.rejects(compileOresToWasm({
    compiler,source:metadataSource,output:out
   }),/overlaps a compiler\/source input/);
   assert.equal(await readFile(metadataSource,"utf8"),original);
  }
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("self-mutating compiler executable cannot publish guest or stale compiler provenance",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-wasm-compiler-identity-"));
 try{
  const source=join(dir,"source.ores"),compiler=join(dir,"compiler.sh"),output=join(dir,"guest.wasm");
  await writeFile(source,"pub fnc main(): int { return 42; }\n");
  await writeFile(compiler,[
   "#!/bin/sh",
   "printf '%s\\n' '#!/bin/sh' 'echo changed' > "+JSON.stringify(compiler),
   "printf 'target triple = \"wasm32-unknown-unknown\"\\ndefine i64 @main() { ret i64 42 }\\n'",
   ""
  ].join("\n"),{mode:0o700});
  await chmod(compiler,0o700);
  await assert.rejects(
    compileOresToWasm({compiler,source,output,environment:"browser"}),
    /compiler executable changed during execution/);
  await assert.rejects(readFile(output),/ENOENT/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test("mutated staged input is rejected even if compiler emits plausible IR",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-wasm-staged-identity-"));
 try{
  const source=join(dir,"source.ores"),compiler=join(dir,"compiler.mjs"),output=join(dir,"guest.wasm");
  await writeFile(source,"pub fnc main(): int { return 42; }\n");
  await writeFile(compiler,[
   "#!/usr/bin/env node",
   'import {writeFileSync} from "node:fs";',
   'writeFileSync(process.argv.at(-1),"tampered source");',
   'process.stdout.write("target triple = \\"wasm32-unknown-unknown\\"\\ndefine i64 @main() { ret i64 42 }\\n");',
   ""
  ].join("\n"),{mode:0o700});
  await chmod(compiler,0o700);
  await assert.rejects(
    compileOresToWasm({compiler,source,output,environment:"browser"}),
    /staged compiler input changed during execution|EACCES|permission denied/);
  await assert.rejects(readFile(output),/ENOENT/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
