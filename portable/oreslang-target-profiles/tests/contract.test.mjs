import test from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {validateRegistry,validateClosure} from "../src/contract.mjs";
import {loadProfiles} from "../src/load-registry.mjs";
const profiles=await loadProfiles();
const good={schemaVersion:1,entry:"app",target:"browser",backend:"wasm",grants:["clock","net.client"],nodes:[{id:"app",targets:["browser","server"],requires:["clock","net.client"],imports:["dep"]},{id:"dep",targets:["browser","server"],requires:["net.client"],imports:[]}]};
const check=data=>validateClosure(data,profiles);
test("eight versioned target profiles conform to vocabulary",()=>assert.deepEqual(validateRegistry(profiles),{ok:true,errors:[]}));
test("portable graph passes",()=>assert.equal(check(good).ok,true));
test("cycles terminate safely when both directions declare transitive requirements",()=>assert.equal(check({...good,nodes:[good.nodes[0],{...good.nodes[1],requires:good.nodes[0].requires,imports:["app"]}]}).ok,true));
test("import target coverage is checked across all promised targets",()=>{const r=check({...good,nodes:[good.nodes[0],{...good.nodes[1],targets:["browser"]}]});assert.match(r.errors.join("\n"),/imported targets/)});
test("dependency cannot escalate declared effects",()=>{const r=check({...good,nodes:[good.nodes[0],{...good.nodes[1],requires:["net.server"]}]});assert.match(r.errors.join("\n"),/requirements/)});
test("capability budget cannot exceed host profile",()=>{const r=check({...good,grants:["interop.java"]});assert.match(r.errors.join("\n"),/grant unavailable/)});
test("build must grant all transitive effects",()=>{const r=check({...good,grants:["net.client"]});assert.match(r.errors.join("\n"),/missing build grants/)});
test("unknown imports, target and backend fail closed",()=>{for(const changed of [{...good,target:"anywhere"},{...good,backend:"dex"},{...good,nodes:[{...good.nodes[0],imports:["missing"]},good.nodes[1]]}])assert.equal(check(changed).ok,false)});
test("duplicate/unknown capabilities and unreachable units rejected",()=>{for(const changed of [{...good,grants:["clock","clock"]},{...good,grants:["clock","superuser"]},{...good,nodes:[...good.nodes,{id:"extra",targets:["server"],requires:[],imports:[]}]}])assert.equal(check(changed).ok,false)});
test("CLI examples run",()=>{const cli=new URL("../bin/oreslang-target.mjs",import.meta.url).pathname;const fixture=new URL("../examples/portable-closure.json",import.meta.url).pathname;const p=spawnSync(process.execPath,[cli,"check-closure",fixture,"--target=browser","--backend=wasm","--grants=clock,net.client"],{encoding:"utf8"});assert.equal(p.status,0,p.stderr);assert.match(p.stdout,/2 units/)});

test("graph schema and backend must be explicit",()=>{
 assert.match(check({...good,schemaVersion:2}).errors.join("\n"),/schemaVersion/);
 assert.match(check({...good,backend:undefined}).errors.join("\n"),/backend/);
});
test("deep linear import chains do not overflow the verifier",()=>{
 const n=3000;
 const nodes=Array.from({length:n},(_,i)=>({id:"unit"+i,targets:["browser"],requires:[],imports:i===n-1?[]:["unit"+(i+1)]}));
 const r=check({...good,entry:"unit0",grants:[],nodes});
 assert.equal(r.ok,true,r.errors.join("; "));
 assert.equal(r.visited,n);
});
test("oversized graph and excessive fanout are refused",()=>{
 assert.match(check({...good,nodes:Array.from({length:4097},(_,i)=>({id:"unit"+i,targets:["browser"],requires:[],imports:[]}))}).errors.join("\n"),/4096/);
 assert.match(check({...good,nodes:[{...good.nodes[0],imports:Array.from({length:257},(_,i)=>"x"+i)},good.nodes[1]]}).errors.join("\n"),/excessive/);
});
