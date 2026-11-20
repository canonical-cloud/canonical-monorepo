import assert from "node:assert/strict";
import { test } from "node:test";
import { validateCandidate } from "../scripts/trusted-candidate-admission.mjs";

const head = "a".repeat(40);
const tree = "b".repeat(40);
function fixture() {
  return {
    number: "195", head, tree,
    pr: { number: 195, state: "open", draft: false,
      base: { ref: "main", repo: {full_name: "canonical-cloud/canonical-web-server.rs"} },
      head: { sha: head, repo: { full_name: "canonical-cloud/canonical-web-server.rs" }},
      labels: [{ name: "trusted-private-ci" }], user: { login: "author" } },
    commit: { sha: head, tree: { sha: tree }},
    reviews: [
      { state: "APPROVED", commit_id: head, author_association: "MEMBER",
        submitted_at: "2026-10-15T18:00:00Z", user: { login: "reviewer" }}
    ]
  };
}
test("accepts only a precise independently approved reviewed commit", () => {
  assert.deepEqual(validateCandidate(fixture()), { number: 195, head, tree });
});
const mutations = [
  ["wrong repo", f => f.pr.head.repo.full_name = "attacker/fork"],
  ["wrong base", f => f.pr.base.ref = "dev"],
  ["draft", f => f.pr.draft = true],
  ["closed", f => f.pr.state = "closed"],
  ["missing label", f => f.pr.labels = []],
  ["changed head", f => f.pr.head.sha = "c".repeat(40)],
  ["wrong tree", f => f.commit.tree.sha = "c".repeat(40)],
  ["wrong commit", f => f.commit.sha = "c".repeat(40)],
  ["wrong PR number", f => f.pr.number = 198],
  ["review by author", f => f.reviews[0].user.login = "author"],
  ["untrusted reviewer", f => f.reviews[0].author_association = "NONE"],
  ["stale approval", f => f.reviews[0].commit_id = "c".repeat(40)],
  ["no approval", f => f.reviews[0].state = "COMMENTED"],
  ["dismissed latest review", f => f.reviews.push({ ...f.reviews[0],
    state: "DISMISSED", submitted_at: "2026-10-16T18:00:00Z" })],
  ["later request changes", f => f.reviews.push({ ...f.reviews[0],
    state: "CHANGES_REQUESTED", submitted_at: "2026-10-16T18:00:00Z" })],
  ["no author", f => f.pr.user = null],
  ["invalid PR selector", f => f.number = "../195"],
  ["invalid 40-hex SHA", f => f.head = "deadbeef"],
  ["missing review data", f => f.reviews = null],
];
for (const [label, mutate] of mutations) {
  test("rejects " + label, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateCandidate(f));
  });
}
test("approval by one trusted reviewer survives an unrelated reviewer comment", () => {
  const f = fixture();
  f.reviews.push({ ...f.reviews[0], state: "COMMENTED",
    submitted_at: "2026-10-16T19:00:00Z", user: {login:"another"}});
  assert.equal(validateCandidate(f).head, head);
});
test("reviewer identity is matched case-insensitively against the PR author", () => {
  const f = fixture();
  f.reviews[0].user.login = "AuThOr";
  assert.throws(() => validateCandidate(f));
});

test("second trusted reviewer requesting changes blocks an otherwise approved candidate", () => {
  const f = fixture();
  f.reviews.push({ state: "CHANGES_REQUESTED", commit_id: head,
    author_association: "MEMBER", submitted_at: "2026-10-16T20:00:00Z",
    user: { login: "second-reviewer" } });
  assert.throws(() => validateCandidate(f), /outstanding trusted reviewer changes request/);
});
test("a dismissed trusted changes request does not override a separate valid approval", () => {
  const f = fixture();
  f.reviews.push({ state: "DISMISSED", commit_id: head,
    author_association: "MEMBER", submitted_at: "2026-10-16T20:00:00Z",
    user: { login: "second-reviewer" } });
  assert.equal(validateCandidate(f).head, head);
});
test("untrusted outsider comment or changes request never grants approval", () => {
  const f = fixture();
  f.reviews = [{ state: "CHANGES_REQUESTED", commit_id: head,
    author_association: "NONE", submitted_at: "2026-10-16T20:00:00Z",
    user: { login: "external" } }];
  assert.throws(() => validateCandidate(f), /current-commit approval/);
});
