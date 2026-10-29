import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {pathToFileURL} from "node:url";
const sha40=/^[a-f0-9]{40}$/;
const baseRefs=new Set(["main","security/canonical-web-consolidated-boundary-20261029"]);
export function admitRemediation({pr,reviews,commit,number,head,tree}){
  assert.match(String(number),/^[1-9][0-9]{0,7}$/);
  assert.match(head,sha40); assert.match(tree,sha40);
  assert.equal(pr.number,Number(number)); assert.equal(pr.state,"open");
  assert.equal(pr.draft,false,"independently reviewed non-draft candidate required");
  for(const repo of [pr.head?.repo,pr.base?.repo])
    assert.equal(repo?.full_name,"canonical-cloud/canonical-web-server.rs");
  assert.ok(baseRefs.has(pr.base?.ref),"unreviewed base branch");
  assert.equal(pr.head.sha,head); assert.equal(commit.sha,head);
  assert.equal(commit.tree?.sha,tree);
  assert.ok(pr.labels?.some(x=>x.name==="trusted-lock-remediation"),"remediation label missing");
  const author=pr.user?.login?.toLowerCase();assert.ok(author);
  assert.ok(Array.isArray(reviews));
  const latest=new Map();
  for(const r of [...reviews].sort((a,b)=>String(a.submitted_at??"").localeCompare(String(b.submitted_at??"")))){
    if(r.user?.login&&r.submitted_at)latest.set(r.user.login.toLowerCase(),r);
  }
  const independent=[...latest.values()].filter(r=>
    r.user.login.toLowerCase()!==author&&
    ["OWNER","MEMBER","COLLABORATOR"].includes(r.author_association));
  assert.ok(!independent.some(r=>r.state==="CHANGES_REQUESTED"),"trusted changes request outstanding");
  assert.ok(independent.some(r=>r.state==="APPROVED"&&r.commit_id===head),
    "independent approval of exact head required");
  return {number:Number(number),head,tree};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [p,r,c,number,head,tree]=process.argv.slice(2);
  assert.ok(p&&r&&c&&number&&head&&tree);
  const [pr,reviews,commit]=await Promise.all([p,r,c].map(f=>readFile(f,"utf8").then(JSON.parse)));
  console.log(admitRemediation({pr,reviews,commit,number,head,tree}));
}
