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
      'source = "registry+https://github.com/rust-lang/crates.io-index"');
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
