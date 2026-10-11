/**
 * Experimental, explicit end-to-end bridge:
 * native oreslang-llvmc (.ores -> LLVM IR) -> clang wasm32 -> Wasm module.
 * There is no fallback or mock compiler; caller must pass a real binary.
 */
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFile,writeFile,mkdir,mkdtemp,rm,rename} from "node:fs/promises";
import {dirname,resolve,isAbsolute,join} from "node:path";
import {fileURLToPath} from "node:url";
const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
function rejectStartSection(bytes){
 let i=8;
 const u32=()=>{let value=0;for(let j=0;j<5;j++){
  if(i>=bytes.length)throw Error("truncated Wasm section length");
  const v=bytes[i++];
  if(j===4 && (v&0xf0))throw Error("invalid Wasm section length");
  value+=(v&127)*2**(7*j);
  if(!(v&128))return value;
 }throw Error("invalid Wasm LEB128 length")};
 while(i<bytes.length){
  const id=bytes[i++],length=u32(),end=i+length;
  if(end>bytes.length)throw Error("truncated linked Wasm module");
  if(id===8)throw Error("linked module has forbidden start section");
  i=end;
 }
}

const absolute=(value,label)=>{if(!value||!isAbsolute(value))throw Error(label+" must be an absolute path");return value};
function run(command,args,{input}={}){
 const output=spawnSync(command,args,{input,encoding:"utf8",timeout:30000,maxBuffer:4*1024*1024,windowsHide:true});
 if(output.error||output.status!==0||output.signal)throw Error("command failed ("+command+"): "+(output.error?.message||output.stderr||"exit "+output.status).slice(0,4000));
 return output.stdout||"";
}
export async function compileOresToWasm({compiler,source,output,exportName="main",clang=process.env.CLANG||"clang",compilerSha256,environment}){
 absolute(compiler,"compiler");
 absolute(source,"source");
 absolute(output,"output");
 if(!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(exportName))throw Error("unsupported export name");
 const [sourceBytes,compilerBytes]=await Promise.all([readFile(source),readFile(compiler)]);
 if(sourceBytes.length>1024*1024)throw Error("source exceeds 1 MiB compiler bridge budget");
 const actualCompilerHash=sha(compilerBytes);
 if(compilerSha256!==undefined&&compilerSha256!==actualCompilerHash)throw Error("compiler binary SHA-256 does not match pinned hash");
 if(environment!==undefined&&!["browser","edge-js","edge-wasi"].includes(environment))
  throw Error("unsupported portable host environment");
 const ir=run(compiler,environment?["--target=wasm32",source]:[source]);
 // The compiler consumes a path, not the bytes we hashed above. Refuse to
 // publish a source digest if that path or the compiler changed during use.
 // This does not attest transitive imports or external toolchain libraries.
 if(sha(await readFile(source))!==sha(sourceBytes))
  throw Error("source changed during compiler execution; refusing stale provenance");
 if(sha(await readFile(compiler))!==actualCompilerHash)
  throw Error("compiler executable changed during execution; refusing stale provenance");
 if(environment&&!/target triple = "wasm32-unknown-unknown"/.test(ir))
  throw Error("compiler did not emit wasm32 target-marked IR");
 if(!new RegExp("define\\s+i64\\s+@"+exportName+"\\s*\\(\\s*\\)").test(ir))throw Error("compiler did not emit the expected i64 @"+exportName+"() export");
 if(ir.length>2*1024*1024)throw Error("generated IR exceeds 2 MiB");
 await mkdir(dirname(output),{recursive:true});
 // Compile into a unique scratch directory. Never leave an unverified Wasm
 // module at the final output path following a failed build or admission.
 const scratch=await mkdtemp(join(dirname(output),".oreslang-wasm-"));
 const provisional=join(scratch,"guest.wasm");
 try{
 // Avoid shell expansion and avoid relying on persistent temporary LLVM IR.
 // Clang reads the native compiler's verified stdout as LLVM IR.
 run(clang,["--target=wasm32","-x","ir","-Oz","-nostdlib",
   "-Wl,--no-entry","-Wl,--export="+exportName,
   "-Wl,--initial-memory=131072","-Wl,--max-memory=131072",
   "-o",provisional,"-"],{input:ir});
 const wasm=await readFile(provisional);
 if(!WebAssembly.validate(wasm))throw Error("linker emitted invalid core Wasm");
 rejectStartSection(wasm);
 const module=new WebAssembly.Module(wasm);
 const imports=WebAssembly.Module.imports(module);
 if(imports.length)throw Error("guest Wasm unexpectedly imports host modules: "+imports.map(x=>x.module+"."+x.name).join(","));
 if(!WebAssembly.Module.exports(module).some(x=>x.name===exportName&&x.kind==="function"))throw Error("guest Wasm missing requested export");
 const record={
  schemaVersion:1,kind:"llvm-ores-to-wasm32-core-experimental",
  compilerSha256:actualCompilerHash,sourceSha256:sha(sourceBytes),
  llvmIrSha256:sha(Buffer.from(ir,"utf8")),wasmSha256:sha(wasm),
  exportName,importCount:imports.length,wasmBytes:wasm.length,
  clangVersion:run(clang,["--version"]).split("\n")[0],
  note:"Binary provenance: exact compiler executable bytes, not proof of source-repository commit or feature parity."
 };
 if(environment){
  const manifest={
   schemaVersion:1,artifactType:"oreslang.core-wasm.i64-v1",
   target:"wasm32",environment,backend:"wasm",entry:exportName,
   wasmSha256:sha(wasm),wasmBytes:wasm.length,requiredCapabilities:[],
   imports:[],memory:{maximumPages:2},
   producer:{compilerSha256:actualCompilerHash,
     sourceSha256:sha(sourceBytes),llvmIrSha256:sha(Buffer.from(ir,"utf8"))}
  };
  await writeFile(join(scratch,"artifact.json"),JSON.stringify(manifest,null,2)+"\n");
 }
 await writeFile(join(scratch,"provenance.json"),JSON.stringify(record,null,2)+"\n");
 await rename(provisional,output);
 await rename(join(scratch,"provenance.json"),output+".provenance.json");
 if(environment)await rename(join(scratch,"artifact.json"),output+".artifact.json");
 return record;
 }finally{await rm(scratch,{recursive:true,force:true})}
}
const calledFromCli=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(calledFromCli){
 try{
  const options=Object.fromEntries(process.argv.slice(2).map(x=>{
   const m=/^--(compiler|source|output|export|clang|compiler-sha256|environment)=(.*)$/.exec(x);
   if(!m)throw Error("unexpected CLI option: "+x);
   return[m[1],m[2]];
  }));
  const record=await compileOresToWasm({
   compiler:options.compiler,source:options.source,
   output:options.output||resolve(projectRoot,"build/guest.wasm"),
   exportName:options.export||"main",clang:options.clang||process.env.CLANG||"clang",
   compilerSha256:options["compiler-sha256"],environment:options.environment
  });
  console.log(JSON.stringify(record,null,2));
 }catch(error){console.error(error.stack||error.message);process.exitCode=1}
}
