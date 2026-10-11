#!/usr/bin/env node
import {runSuite} from "../src/harness.mjs";
try{
 const args=Object.fromEntries(process.argv.slice(2).map(x=>{
  if(x==="--require")return["require","true"];
  const m=/^--(backend|argv|source-sha|timeout-ms)=(.+)$/.exec(x);
  if(!m)throw Error("unexpected argument: "+x);
  return[m[1],m[2]];
 }));
 const argv=args.argv?JSON.parse(args.argv):undefined;
 const result=await runSuite({backend:args.backend||"java",argv,sourceSha:args["source-sha"],
   timeoutMs:args["timeout-ms"]?Number(args["timeout-ms"]):10000,requireConfigured:args.require==="true"});
 console.log(JSON.stringify(result,null,2));
 if(!result.ok || !result.configured)process.exitCode= result.ok?3:1;
}catch(e){console.error(e.stack||e.message);process.exitCode=2}
