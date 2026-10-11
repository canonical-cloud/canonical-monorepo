#!/usr/bin/env node
import {readFile} from "node:fs/promises";
import {validateRegistry,validateClosure} from "../src/contract.mjs";
import {loadProfiles} from "../src/load-registry.mjs";
const [command,file,...options]=process.argv.slice(2);
try{
 const profiles=await loadProfiles();
 let result;
 if(command==="list"){for(const p of profiles)console.log(p.name+"\t"+p.backends.join(","));process.exit(0)}
 if(command==="validate-registry"){result=validateRegistry(profiles)}
 else if(command==="check-closure"){
  if(!file||file.startsWith("--"))throw Error("expected graph JSON path");
  const args=Object.fromEntries(options.map(x=>{const m=/^--(target|backend|grants)=(.*)$/.exec(x);if(!m)throw Error("unexpected option "+x);return[m[1],m[2]]}));
  const graph=JSON.parse(await readFile(file,"utf8"));
  result=validateClosure({...graph,target:args.target,backend:args.backend,grants:args.grants?args.grants.split(","):[]},profiles);
 }else throw Error("usage: list | validate-registry | check-closure <graph.json> --target=browser --backend=wasm --grants=clock,net.client");
 if(!result.ok){console.error(result.errors.join("\n"));process.exitCode=1}
 else console.log("OK"+(result.visited?" ("+result.visited+" units checked)":""));
}catch(e){console.error(e.message);process.exitCode=2}
