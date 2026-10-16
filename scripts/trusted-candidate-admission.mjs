import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const SHA = /^[a-f0-9]{40}$/;
const qualifiedRepo = "canonical-cloud/canonical-web-server.rs";
const authorizedAssociations = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

export function validateCandidate({ pr, reviews, commit, number, head, tree }) {
  assert.match(String(number), /^[1-9][0-9]{0,7}$/, "valid PR number required");
  assert.match(head, SHA, "exact immutable SHA required");
  assert.match(tree, SHA, "exact expected source-tree SHA required");
  assert.equal(pr.number, Number(number), "PR identity mismatch");
  assert.equal(pr.state, "open", "PR must be open");
  assert.equal(pr.draft, false, "draft PR cannot access private-Cargo validation");
  assert.equal(pr.base?.ref, "main", "PR base must be main");
  assert.equal(pr.base?.repo?.full_name, qualifiedRepo, "PR base repository mismatch");
  assert.equal(pr.head?.repo?.full_name, qualifiedRepo, "head repository must be canonical web server");
  assert.equal(pr.head?.sha, head, "PR head has changed since approval");
  assert.ok(pr.labels?.some(l => l.name === "trusted-private-ci"),
    "trusted-private-ci label required");
  assert.equal(commit.sha, head, "Git commit identity mismatch");
  assert.equal(commit.tree?.sha, tree, "Git-tree SHA mismatch");
  assert.ok(Array.isArray(reviews), "review data must be an array");
  const latest = new Map();
  for (const review of [...reviews].sort((a, b) =>
    String(a.submitted_at ?? "").localeCompare(String(b.submitted_at ?? "")))) {
    const reviewer = review.user?.login;
    if (reviewer && review.submitted_at) latest.set(reviewer.toLowerCase(), review);
  }
  const author = pr.user?.login?.toLowerCase();
  assert.ok(author, "PR author is required");
  const approved = [...latest.values()].some(review =>
    review.state === "APPROVED" &&
    review.commit_id === head &&
    review.user.login.toLowerCase() !== author &&
    authorizedAssociations.has(review.author_association)
  );
  assert.ok(approved, "independent current-commit approval by a trusted reviewer required");
  return { head, tree, number: Number(number) };
}

async function main() {
  const [prFile, reviewsFile, commitFile, number, head, tree] = process.argv.slice(2);
  assert.ok(prFile && reviewsFile && commitFile && number && head && tree,
    "usage: trusted-candidate-admission.mjs pr.json reviews.json commit.json number head tree");
  const [pr, reviews, commit] = await Promise.all(
    [prFile, reviewsFile, commitFile].map(f => readFile(f, "utf8").then(JSON.parse))
  );
  const approved = validateCandidate({ pr, reviews, commit, number, head, tree });
  console.log("Approved immutable candidate:", approved.number, approved.head, approved.tree);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
