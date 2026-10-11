import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,chmod,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {compileOresToWasm} from "../scripts/compile-ores.mjs";

test("source modified by compiler cannot be represented by original source SHA",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"oreslang-source-pin-"));
 try{
  const compiler=join(dir,"compiler.sh"),source=join(dir,"main.ores"),output=join(dir,"guest.wasm");
  await writeFile(source,"pub fnc main(): int { return 42; }\n");
  await writeFile(compiler,
   "#!/bin/sh\nprintf 'define i64 @main() { ret i64 42 }\\n'\nprintf 'tampered\\n' > \"$1\"\n",{mode:0o700});
  await chmod(compiler,0o700);
  await assert.rejects(compileOresToWasm({compiler,source,output}),
   /source changed during compiler execution/);
  await assert.rejects(readFile(output),/ENOENT/);
  await assert.rejects(readFile(output+".provenance.json"),/ENOENT/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test("self-modifying compiler binary cannot retain the old compiler SHA",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"oreslang-compiler-pin-"));
 try{
  const compiler=join(dir,"compiler.sh"),source=join(dir,"main.ores"),output=join(dir,"guest.wasm");
  await writeFile(source,"pub fnc main(): int { return 42; }\n");
  await writeFile(compiler,
   "#!/bin/sh\nprintf 'define i64 @main() { ret i64 42 }\\n'\nprintf '# changed\\n' >> \"$0\"\n",{mode:0o700});
  await chmod(compiler,0o700);
  await assert.rejects(compileOresToWasm({compiler,source,output}),
   /compiler executable changed during execution/);
  await assert.rejects(readFile(output),/ENOENT/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
