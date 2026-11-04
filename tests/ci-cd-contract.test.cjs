const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('CI workflow is read-only and focused', () => {
  const workflow = read('.github/workflows/ci-tests.yml');
  assert.match(workflow, /push:\s*\n\s+branches: \[main\]/);
  assert.match(workflow, /pull_request:\s*\n\s+branches: \[main\]/);
  assert.doesNotMatch(workflow, /^\s+workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /branches: \[dev/);
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
  assert.match(workflow, /cd release/);
  assert.match(workflow, /sort -z/);
  assert.match(workflow, /sha256sum -c SHA256SUMS\.txt/);
  assert.match(workflow, /release contains no artifacts/);
  assert.doesNotMatch(workflow, /find release .*sha256sum/);
});

test('release workflow derives the tag from package version and requires protection', () => {
  const workflow = read('.github/workflows/publish-release.yml');
  const packageJson = JSON.parse(read('package.json'));
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request):/m);
  assert.match(workflow, /github\.actor == 'edarkea'/);
  assert.match(workflow, /ATOMIC_RELEASE_PUBLISHERS/);
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /Read package version/);
  assert.match(workflow, /steps\.metadata\.outputs\.version/);
  assert.match(workflow, /git tag --annotate "\$RELEASE_TAG" "\$RELEASE_SHA"/);
  assert.match(workflow, /git push origin "\$RELEASE_TAG"/);
  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /package\.json.*version|packageVersion/);
  assert.match(workflow, /environment:\s*\n\s+name: production-release/);
  assert.match(workflow, /permissions:\s*\n\s+contents: write/);
  assert.match(workflow, /--verify-tag/);
  assert.match(workflow, /Verify manifests and stage release artifacts/);
  assert.match(workflow, /release\/publish/);
  assert.match(workflow, /cd release\/windows && sha256sum -c SHA256SUMS\.txt/);
  assert.match(workflow, /cd release\/linux && sha256sum -c SHA256SUMS\.txt/);
  assert.match(workflow, /artifact name collision/);
  assert.match(workflow, /builder-debug\.yml/);
  assert.match(workflow, /win-unpacked/);
  assert.match(workflow, /linux-unpacked/);
  assert.match(workflow, /verify_update_manifest/);
  assert.match(workflow, /global_manifest/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /gh release view "\$RELEASE_TAG" --repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /gh release create "\$RELEASE_TAG" "\$\{release_files\[@\]\}"/);
  assert.doesNotMatch(workflow, /cp release\/windows\/\* release\/linux\/\* release\//);
  assert.doesNotMatch(workflow, /gh release create "\$RELEASE_TAG" release\/\*/);
  assert.doesNotMatch(workflow, /inputs\.(version|tag|ref)/);
  assert.doesNotMatch(workflow, /tag_sha/);
  assert.equal(packageJson.version, '0.0.1');
});
