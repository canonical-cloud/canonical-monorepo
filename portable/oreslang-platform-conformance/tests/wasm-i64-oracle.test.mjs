import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
const script=new URL("../bin/wasm-core-conformance.mjs",import.meta.url).pathname;
const args=oracle=>["--wasm=/missing/guest.wasm","--manifest=/missing/artifact.json",
 "--browser-module=/missing/loader.mjs","--expected-i64="+oracle];
test("Wasm oracle rejects values outside signed 64-bit bounds",()=>{
 for(const x of ["9223372036854775808","-9223372036854775809"]){
  const r=spawnSync(process.execPath,[script,...args(x)],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/signed 64-bit range/);
 }
});
test("min/max signed i64 and noncanonical numeric input pass range validation",()=>{
 for(const x of ["9223372036854775807","-9223372036854775808","00042","-0"]){
  const r=spawnSync(process.execPath,[script,...args(x)],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.doesNotMatch(r.stderr,/out of signed 64-bit range/);
 }
});
test("noninteger Wasm oracle is rejected",()=>{
 for(const x of ["42.0","+42","0x2a"]){
  const r=spawnSync(process.execPath,[script,...args(x)],{encoding:"utf8"});
  assert.notEqual(r.status,0);
  assert.match(r.stderr,/expected-i64 must be an integer/);
 }
});
