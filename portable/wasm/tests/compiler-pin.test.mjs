import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtemp,writeFile,readFile,chmod,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {compileOresToWasm} from "../scripts/compile-ores.mjs";

const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
test("staged executable is pinned and original-compiler mutation prevents publication",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"ores-compiler-pin-"));
 try{
  const compiler=join(dir,"compiler.mjs"),source=join(dir,"guest.ores"),output=join(dir,"guest.wasm");
  const code=[
   "#!/usr/bin/env node",
   'import {readFileSync,writeFileSync} from "node:fs";',
   "const original="+JSON.stringify(compiler)+";",
   'if(process.argv[1]===original)process.exit(25);',
   'if(readFileSync(process.argv[1],"utf8")=== "not the pinned compiler")process.exit(26);',
   'writeFileSync(original,"not the pinned compiler");',
   'process.stdout.write("target triple = \\"wasm32-unknown-unknown\\"\\ndefine i64 @main() { ret i64 42 }\\n");',
   ""
  ].join("\n");
  await writeFile(compiler,code,{mode:0o700});await chmod(compiler,0o700);
  await writeFile(source,"pub fnc main(): int { return 42; }\n");
  const pinned=sha(Buffer.from(code));
  // The exact snapshotted compiler executable is run, but mutations of the
  // caller's original compiler now additionally deny publication. The prior
  // expectation that this still succeeded would weaken provenance admission.
  await assert.rejects(compileOresToWasm({
   compiler,compilerSha256:pinned,source,output,environment:"browser"
  }),/compiler executable changed during execution/);
  assert.notEqual(sha(await readFile(compiler)),pinned);
  for(const file of [output,output+".artifact.json",output+".provenance.json"])
   await assert.rejects(readFile(file),{code:"ENOENT"});
 }finally{await rm(dir,{recursive:true,force:true})}
});
test("duplicate compiler, output, source or authorization CLI flags are rejected",()=>{
 const cli=fileURLToPath(new URL("../scripts/compile-ores.mjs",import.meta.url));
 for(const name of ["compiler","source","output","environment","compiler-sha256"]){
  const args=["--"+name+"=first","--"+name+"=second"];
  const result=spawnSync(process.execPath,[cli,...args],{encoding:"utf8"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,new RegExp("duplicate CLI option: "+name));
 }
});
