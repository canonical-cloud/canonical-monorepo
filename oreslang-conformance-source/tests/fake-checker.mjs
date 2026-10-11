import {readFile} from "node:fs/promises";
const file=process.argv[2];
const content=await readFile(file,"utf8");
if(content.includes("nonexistent_symbol")){
 console.error("error: unresolved identifier nonexistent_symbol");
 process.exitCode=1;
}else console.log("FAKE CHECK OK - harness test only");
