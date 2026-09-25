import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const audit = await readFile(
  new URL("../scripts/audit-repo-state.sh", import.meta.url),
  "utf8",
);
const ci = await readFile(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);

test("review-pin audit exceptions are exact, explicit, and fail closed", () => {
  assert.match(audit, /--allow-review-pin/);
  assert.match(
    audit,
    /\^\(apps\/\[A-Za-z0-9\._\/-\]\+\)=\(\[0-9a-f\]\{40\}\)\$/,
  );
  assert.match(audit, /duplicate --allow-review-pin/);
  assert.match(
    audit,
    /expected_review_sha="\$\{allowed_review_pins\[\$module_path\]:-\}"/,
  );
  assert.match(
    audit,
    /"\$pinned_sha" == "\$expected_review_sha"/,
  );
  assert.match(audit, /used_review_pins\["\$module_path"\]=1/);
  assert.match(
    audit,
    /review pin exception \$review_path=\$\{allowed_review_pins\[\$review_path\]\} did not match an initialized off-main gitlink/,
  );
  assert.match(
    audit,
    /fail "\$module_path: could not fetch origin\/\$module_branch to verify the pin"/,
  );
});

test("DEN-3938 integration CI names every admitted review pin by exact SHA", () => {
  const expected = [
    "apps/canonical-api-server.rs=a0a2c7737aaf241ac4c991eef3e2a2da0a29b069",
    "apps/canonical-web-server.rs=64bccc3d557cbdb97e37ca22641b15cc3a38e21f",
    "apps/canonical-mcp-server.rs=d27ec6e364be7d75ef747b6e32862ab3696317a1",
  ];

  for (const pin of expected) {
    assert.match(ci, new RegExp(`--allow-review-pin ${pin.replaceAll(".", "\\.")}`));
  }
  assert.equal((ci.match(/--allow-review-pin/g) ?? []).length, expected.length);
});
