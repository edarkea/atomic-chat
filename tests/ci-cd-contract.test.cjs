const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('CI workflow is read-only and focused', () => {
  const workflow = read('.github/workflows/ci-tests.yml');
  assert.match(workflow, /push:\s*\n\s+branches: \[dev, main\]/);
  assert.match(workflow, /pull_request:\s*\n\s+branches: \[dev, main\]/);
  assert.match(workflow, /^\s+workflow_dispatch:/m);
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /npm run test:ci:focused/);
  assert.doesNotMatch(workflow, /test:p0|npm test\b/);
  assert.match(workflow, /cancel-in-progress: true/);
});

test('manual build workflow never publishes and has no write permission', () => {
  const workflow = read('.github/workflows/manual-build.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /--publish never/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /contents: write|GH_TOKEN|CSC_LINK/);
  assert.match(workflow, /install-app-deps/);
  assert.match(workflow, /SHA256SUMS/);
});

test('release workflow requires actor, stable version, protected tag and environment', () => {
  const workflow = read('.github/workflows/publish-release.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request):/m);
  assert.match(workflow, /github\.actor == 'edarkea'/);
  assert.match(workflow, /ATOMIC_RELEASE_PUBLISHERS/);
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /checked_sha=/);
  assert.match(workflow, /test "\$checked_sha" = "\$tag_sha"/);
  assert.match(workflow, /RELEASE_VERSION: \$\{\{ inputs\.version \}\}/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /package\.json.*version|packageVersion/);
  assert.match(workflow, /environment:\s*\n\s+name: production-release/);
  assert.match(workflow, /permissions:\s*\n\s+contents: write/);
  assert.match(workflow, /--verify-tag/);
  assert.doesNotMatch(workflow, /if \('\$\{\{ inputs\./);
  assert.doesNotMatch(workflow, /gh release (view|create) "\$\{\{ inputs\./);
  assert.doesNotMatch(workflow, /npm version|git tag /);
});
