import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile,chmod,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compileOresToWasm} from "../scripts/compile-ores.mjs";

// A compiler-stdout stand-in, NOT evidence of native Oreslang frontend execution.
async function fixture(dir){
 const compiler=join(dir,"compiler.mjs"),source=join(dir,"source.ores");
 const ir=['target triple = "wasm32-unknown-unknown"',
   'define i64 @main() { ret i64 42 }'].join("\n")+"\n";
 // Produce a REAL runnable compiler stand-in so negative publication tests
 // cannot pass prematurely on ENOENT / a malformed #! interpreter path.
 await writeFile(compiler,"#!/usr/bin/env node\nprocess.stdout.write("+
   JSON.stringify(ir)+");\n",{mode:0o700});
 await chmod(compiler,0o700);
 await writeFile(source,"pub fnc main(): int { return 42; }\n");
 return {compiler,source};
}
test("failed artifact sidecar publication cannot expose new Wasm",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-wasm-publish-"));
 try{
  const {compiler,source}=await fixture(dir);
  const output=join(dir,"guest.wasm");
  await mkdir(output+".artifact.json"); // directory collides with promised metadata path
  await assert.rejects(compileOresToWasm({compiler,source,output,environment:"browser"}));
  await assert.rejects(readFile(output),/ENOENT/);
  await assert.rejects(readFile(output+".provenance.json"),/ENOENT/);
  assert.equal((await readdir(dir)).some(x=>x.startsWith(".oreslang-wasm-")),false);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test("failed provenance sidecar publication cannot expose new Wasm",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-wasm-publish-"));
 try{
  const {compiler,source}=await fixture(dir),output=join(dir,"guest.wasm");
  await mkdir(output+".provenance.json");
  await assert.rejects(compileOresToWasm({compiler,source,output}));
  await assert.rejects(readFile(output),/ENOENT/);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test("oversized linked Wasm is rejected before it is read or published",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-wasm-output-budget-"));
 try{
  const {compiler,source}=await fixture(dir);
  const clang=join(dir,"clang-oversize.mjs"),output=join(dir,"guest.wasm");
  await writeFile(clang,[
   "#!/usr/bin/env node",
   'import {openSync,ftruncateSync,closeSync} from "node:fs";',
   'const i=process.argv.indexOf("-o");if(i<0)process.exit(31);',
   'const fd=openSync(process.argv[i+1],"w");',
   'ftruncateSync(fd,16*1024*1024+1);closeSync(fd);'
  ].join("\n"),{mode:0o700});
  await chmod(clang,0o700);
  await assert.rejects(
   compileOresToWasm({source,compiler,output,clang,environment:"browser"}),
   /linked Wasm exceeds 16 MiB artifact budget/
  );
  await assert.rejects(readFile(output),/ENOENT/);
  await assert.rejects(readFile(output+".artifact.json"),/ENOENT/);
  await assert.rejects(readFile(output+".provenance.json"),/ENOENT/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
