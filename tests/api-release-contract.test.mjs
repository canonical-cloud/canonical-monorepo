import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const release = await readFile(
  new URL("../.github/workflows/release.yml", import.meta.url),
  "utf8",
);

test("release publishes and attests a standalone Canonical API image", () => {
  assert.match(
    release,
    /API_IMAGE: ghcr\.io\/canonical-cloud\/canonical-api-server/,
  );
  assert.match(release, /name: Build and publish customer API image/);
  assert.match(release, /id: api/);
  assert.match(release, /target: api/);
  assert.match(
    release,
    /\$\{\{ env\.API_IMAGE \}\}:\$\{\{ env\.RELEASE_SHA \}\}/,
  );
  assert.match(release, /subject-name: \$\{\{ env\.API_IMAGE \}\}/);
  assert.match(release, /subject-digest: \$\{\{ steps\.api\.outputs\.digest \}\}/);
});

test("sanitized release ledger and GitOps handoff carry the API digest", () => {
  assert.match(release, /API_DIGEST: \$\{\{ steps\.api\.outputs\.digest \}\}/g);
  assert.match(release, /api: \{image: \$api_image, digest: \$api_digest\}/);
  assert.match(
    release,
    /\.api\.image == "ghcr\.io\/canonical-cloud\/canonical-api-server"/g,
  );
  assert.match(release, /\.api\.digest \| test\("\^sha256:/g);
  assert.match(release, /--api-digest %s/);
  assert.doesNotMatch(release, /API_DIGEST.*(?:token|secret|authorization)/i);
});
