import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";

test("bridge CLI rejects duplicate compiler and output options before reading input",()=>{
 for(const name of ["compiler","source","output","environment","clang"]){
  const arg="--"+name+"=/tmp/placeholder";
  const cmd=spawnSync(process.execPath,[new URL("../scripts/compile-ores.mjs",import.meta.url).pathname,arg,arg],{
   encoding:"utf8",timeout:3000,windowsHide:true
  });
  assert.equal(cmd.status,1,name);
  assert.match(cmd.stderr,new RegExp("duplicate CLI option: "+name),name);
 }
});
