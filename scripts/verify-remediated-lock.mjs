import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
export const floors=Object.freeze({"ctutils":"0.4.4","quinn-proto":"0.11.18",
"rustls":"0.23.46","rustls-webpki":"0.103.16","webpki-root-certs":"1.0.10",
"webpki-roots":"1.0.10","tokio":"1.53.3"});
const version=/^\d+\.\d+\.\d+$/;
function compare(a,b){
  assert.match(a,version);assert.match(b,version);
  const x=a.split(".").map(Number),y=b.split(".").map(Number);
  for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]-y[i];
  return 0;
}
function parsed(lock){
  assert.ok(lock.length<8000000&&!lock.includes("\0"));
  assert.match(lock,/^version\s*=\s*\d+\s*$/m);
  const items=lock.split(/^\[\[package\]\]\s*$/m).slice(1);
  assert.ok(items.length>0);
  const registry="registry+https://github.com/rust-lang/crates.io-index";
  const seen=new Set();
  return items.map(c=>{
    const pkg={
      name:c.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1],
      version:c.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1],
      source:c.match(/^source\s*=\s*"([^"]+)"\s*$/m)?.[1],
      checksum:c.match(/^checksum\s*=\s*"([^"]+)"\s*$/m)?.[1]
    };
    assert.ok(pkg.name && pkg.version,"incomplete Cargo.lock package identity");
    assert.ok(pkg.source===undefined || pkg.source===registry || pkg.source.startsWith("git+"),
      "unapproved Cargo registry/source: "+pkg.name);
    if(pkg.source===registry){
      assert.match(pkg.checksum??"",/^[a-f0-9]{64}$/,
        pkg.name+" registry checksum must be present and a 64-hex SHA256");
      assert.equal((c.match(/^checksum\s*=/gm)??[]).length,1,
        pkg.name+" registry checksum must appear exactly once");
    } else {
      assert.equal(pkg.checksum,undefined,
        pkg.name+" non-registry package cannot impersonate a registry checksum");
    }
    const identity=[pkg.name,pkg.version,pkg.source??""].join("\0");
    assert.ok(!seen.has(identity),"duplicate Cargo.lock package: "+pkg.name);
    seen.add(identity);
    return pkg;
  });
}
export function verifyResolved(original,updated){
  assert.notEqual(original,updated,"no Cargo-resolved lockfile change");
  assert.doesNotMatch(updated,/x-access-token|github_pat_|ghp_[A-Za-z0-9]{12,}/);
  const before=parsed(original),after=parsed(updated);
  const git=items=>items.filter(p=>p.source?.startsWith("git+"))
    .map(p=>[p.name,p.version,p.source].join("\0")).sort();
  assert.deepEqual(git(after),git(before),"pinned Git sources changed");
  const failures=[];
  for(const [name,minimum] of Object.entries(floors)){
    const old=before.filter(p=>p.name===name&&p.source?.startsWith("registry+"));
    const next=after.filter(p=>p.name===name&&p.source?.startsWith("registry+"));
    assert.ok(old.length&&next.length,"reviewed registry family missing: "+name);
    for(const p of next)
      if(!p.version||compare(p.version,minimum)<0||(name==="tokio"&&p.version==="1.54.0"))
        failures.push(name+"@"+p.version);
  }
  assert.deepEqual(failures,[],"known vulnerable locked versions remain");
  return {families:Object.keys(floors).length,gitEntries:git(after).length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [before,after]=process.argv.slice(2);assert.ok(before&&after);
  console.log(verifyResolved(await readFile(before,"utf8"),await readFile(after,"utf8")));
}
