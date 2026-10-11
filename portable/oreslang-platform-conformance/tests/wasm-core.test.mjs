import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {isAbsolute} from "node:path";
const script=new URL("../bin/wasm-core-conformance.mjs",import.meta.url).pathname;
test("cross-repo Wasm gate requires every exact artifact input",()=>{
 for(const argv of [
  [],
  ["--wasm=x","--manifest=x","--browser-module=x","--expected-i64=42"],
  ["--wasm=/missing","--manifest=/missing","--browser-module=/missing","--expected-i64=notanumber"]
 ]){
  const r=spawnSync(process.execPath,[script,...argv],{encoding:"utf8"});
  assert.notEqual(r.status,0);
 }
});
test("real Oreslang LLVM-to-Wasm-to-browser guest gate, opt-in and not faked",{
 skip:!(process.env.ORESLANG_GUEST_WASM&&process.env.ORESLANG_BROWSER_ADAPTER)
},()=>{
 const wasm=process.env.ORESLANG_GUEST_WASM;
 const manifest=wasm+".artifact.json";
 const browser=process.env.ORESLANG_BROWSER_ADAPTER;
 assert.ok(isAbsolute(wasm)&&isAbsolute(browser));
 const r=spawnSync(process.execPath,[script,"--wasm="+wasm,
  "--manifest="+manifest,"--browser-module="+browser,"--expected-i64=42"],{encoding:"utf8",timeout:10000});
 assert.equal(r.status,0,r.stderr);
 const report=JSON.parse(r.stdout);
 assert.equal(report.ok,true);
 assert.equal(report.observedI64,"42");
 assert.match(report.artifactSha256,/^[a-f0-9]{64}$/);
});
