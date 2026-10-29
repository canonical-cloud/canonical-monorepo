import assert from "node:assert/strict";
import {test} from "node:test";
import {admitRemediation} from "../scripts/trusted-remediation-admission.mjs";
const head="a".repeat(40),tree="b".repeat(40);
function fixture(){
  return {number:207,head,tree,
  pr:{number:207,state:"open",draft:false,
    user:{login:"author"},labels:[{name:"trusted-lock-remediation"}],
    head:{sha:head,repo:{full_name:"canonical-cloud/canonical-web-server.rs"}},
    base:{ref:"security/canonical-web-consolidated-boundary-20261029",
      repo:{full_name:"canonical-cloud/canonical-web-server.rs"}}},
  commit:{sha:head,tree:{sha:tree}},
  reviews:[{state:"APPROVED",commit_id:head,author_association:"MEMBER",
    user:{login:"independent"},submitted_at:"2026-10-29T18:00:00Z"}]};
}
test("admits exact approved pinned same-repo remediation",()=>{
  assert.deepEqual(admitRemediation(fixture()),{number:207,head,tree});
});
for(const [name,change] of [
  ["draft",f=>f.pr.draft=true],
  ["changed head",f=>f.pr.head.sha="c".repeat(40)],
  ["changed tree",f=>f.commit.tree.sha="c".repeat(40)],
  ["fork",f=>f.pr.head.repo.full_name="other/fork"],
  ["unapproved base",f=>f.pr.base.ref="random-branch"],
  ["missing opt-in",f=>f.pr.labels=[]],
  ["self approval",f=>f.reviews[0].user.login="author"],
  ["untrusted approval",f=>f.reviews[0].author_association="NONE"],
  ["stale approval",f=>f.reviews[0].commit_id="c".repeat(40)],
  ["later changes request",f=>f.reviews.push({...f.reviews[0],
    state:"CHANGES_REQUESTED",submitted_at:"2026-10-29T19:00:00Z"})],
  ["invalid PR selector",f=>f.number="../207"]
])test("remediation admission rejects "+name,()=>{
  const f=fixture();change(f);assert.throws(()=>admitRemediation(f));
});
