import assert from "node:assert/strict";
import {test} from "node:test";
import {floors,verifyResolved} from "../scripts/verify-remediated-lock.mjs";
const old={"ctutils":"0.4.2","quinn-proto":"0.11.16","rustls":"0.23.45",
"rustls-webpki":"0.103.15","webpki-root-certs":"1.0.9",
"webpki-roots":"1.0.9","tokio":"1.53.1"};
const gitSource="git+https://github.com/canonical-cloud/canonical-lib-core?rev="+"a".repeat(40)+"#"+"a".repeat(40);
function lock(versions,source=gitSource){
  const lines=['version = 4'];
  for(const [name,version] of Object.entries(versions))
    lines.push('[[package]]','name = "'+name+'"','version = "'+version+'"',
      'source = "registry+https://github.com/rust-lang/crates.io-index"',
      'checksum = "'+'f'.repeat(64)+'"');
  lines.push('[[package]]','name = "private-one"','version = "0.1.0"',
    'source = "'+source+'"');
  return lines.join("\n")+"\n";
}
test("accepts genuine proposed versions with stable Git source",()=>{
  assert.deepEqual(verifyResolved(lock(old),lock(floors)),
    {families:7,gitEntries:1});
});
test("rejects unchanged lock",()=>assert.throws(()=>verifyResolved(lock(old),lock(old))));
test("rejects all seven vulnerable versions",()=>assert.throws(()=>verifyResolved(lock(old),lock(old).replace('ctutils','ctutils2'))));
test("rejects Tokio 1.54.0 use-after-free",()=>{
  assert.throws(()=>verifyResolved(lock(old),lock({...floors,tokio:"1.54.0"})));
});
test("rejects changed Git pin",()=>{
  assert.throws(()=>verifyResolved(lock(old),lock(floors,gitSource.replace(/a/g,"c"))));
});
test("rejects missing protected registry family",()=>{
  const next={...floors};delete next.rustls;assert.throws(()=>verifyResolved(lock(old),lock(next)));
});
test("rejects credential-like output",()=>{
  assert.throws(()=>verifyResolved(lock(old),lock(floors)+'\n# x-access-token'));
});

test("rejects substituted package registry even at apparently safe version",()=>{
  const fraudulent=lock(floors).replace(
    "registry+https://github.com/rust-lang/crates.io-index",
    "registry+https://attacker.example/forged-index");
  assert.throws(()=>verifyResolved(lock(old),fraudulent),/unapproved Cargo registry/);
});
test("rejects missing registry checksum, not just vulnerable version",()=>{
  const tampered=lock(floors).replace('checksum = "'+"f".repeat(64)+'"',"");
  assert.throws(()=>verifyResolved(lock(old),tampered),/checksum/);
});
test("rejects non-hex checksum and duplicate checksum keys",()=>{
  const first=lock(floors).replace("f".repeat(64),"not-sha256");
  assert.throws(()=>verifyResolved(lock(old),first),/checksum/);
  const doubled=lock(floors).replace('checksum = "'+"f".repeat(64)+'"',
    'checksum = "'+"f".repeat(64)+'"\nchecksum = "'+"f".repeat(64)+'"');
  assert.throws(()=>verifyResolved(lock(old),doubled),/exactly once/);
});
test("rejects duplicate registry package identities hidden after valid floor",()=>{
  const tampered=lock(floors).replace(
    '[[package]]\nname = "ctutils"',
    '[[package]]\nname = "ctutils"\nversion = "0.4.4"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\nchecksum = "'+"f".repeat(64)+'"\n\n[[package]]\nname = "ctutils"');
  assert.throws(()=>verifyResolved(lock(old),tampered),/duplicate Cargo.lock package/);
});
test("rejects unreviewed alternate source on unrelated transitive crate",()=>{
  const tampered=lock(floors)+'\n[[package]]\nname = "transitive"\nversion = "1.0.0"\nsource = "sparse+https://evil.example"\n';
  assert.throws(()=>verifyResolved(lock(old),tampered),/unapproved Cargo registry/);
});
