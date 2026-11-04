const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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
  assert.match(workflow, /\[System\.IO\.File\]::WriteAllText/);
  assert.match(workflow, /\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
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
  assert.match(workflow, /\[System\.IO\.File\]::WriteAllText/);
  assert.match(workflow, /\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(workflow, /normalize_windows_manifest/);
  assert.match(workflow, /perl -0pe/);
  assert.match(workflow, /release_status/);
  assert.equal(packageJson.version, '0.0.1');
});

test('Windows checksum normalization accepts line endings and rejects bad or missing artifacts', () => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-checksum-'));
  const releaseDirectory = path.join(rootDirectory, 'release');
  const stagingDirectory = path.join(rootDirectory, 'publish');
  fs.mkdirSync(releaseDirectory);
  fs.mkdirSync(stagingDirectory);

  const artifactName = 'Atomic Chat Setup 0.0.1.exe';
  const artifactPath = path.join(releaseDirectory, artifactName);
  const artifactContents = Buffer.from('valid installer bytes');
  fs.writeFileSync(artifactPath, artifactContents);
  const hash = crypto.createHash('sha256').update(artifactContents).digest('hex');
  const checksumLine = `${hash}  ${artifactName}`;

  const normalizeManifest = (contents) =>
    contents.replace(/\r+(?:\n|$)/g, '\n').replace(/\r+(?=[0-9A-Fa-f]{64}  )/g, '\n');
  const verifyManifest = (manifestPath, baseDirectory) => {
    const lines = fs
      .readFileSync(manifestPath, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    for (const line of lines) {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
      if (!match) throw new Error(`invalid checksum line: ${line}`);
      const filePath = path.join(baseDirectory, match[2]);
      if (!fs.existsSync(filePath)) throw new Error(`missing checksum artifact: ${match[2]}`);
      const actualHash = crypto
        .createHash('sha256')
        .update(fs.readFileSync(filePath))
        .digest('hex');
      if (actualHash !== match[1]) throw new Error(`checksum mismatch: ${match[2]}`);
    }
  };

  try {
    for (const [index, lineEnding] of ['\n', '\r\n', '\r\r\n'].entries()) {
      const sourceManifest = path.join(rootDirectory, `source-${index}.txt`);
      const normalizedManifest = path.join(rootDirectory, `normalized-${index}.txt`);
      fs.writeFileSync(sourceManifest, `${checksumLine}${lineEnding}`, 'utf8');
      fs.writeFileSync(
        normalizedManifest,
        normalizeManifest(fs.readFileSync(sourceManifest, 'utf8')),
        'utf8',
      );
      assert.doesNotThrow(() => verifyManifest(normalizedManifest, releaseDirectory));
    }

    const validManifest = path.join(rootDirectory, 'valid.txt');
    fs.writeFileSync(validManifest, `${checksumLine}\n`, 'utf8');
    fs.writeFileSync(artifactPath, Buffer.from('altered installer bytes'));
    assert.throws(() => verifyManifest(validManifest, releaseDirectory), /checksum mismatch/);

    fs.unlinkSync(artifactPath);
    assert.throws(
      () => verifyManifest(validManifest, releaseDirectory),
      /missing checksum artifact/,
    );

    const stagedArtifact = path.join(stagingDirectory, artifactName);
    const debugFile = path.join(releaseDirectory, 'builder-debug.yml');
    const unpackedDirectory = path.join(releaseDirectory, 'win-unpacked');
    fs.writeFileSync(artifactPath, artifactContents);
    fs.writeFileSync(debugFile, 'debug');
    fs.mkdirSync(unpackedDirectory);
    fs.writeFileSync(path.join(unpackedDirectory, 'app.exe'), 'unpacked');

    for (const entry of fs.readdirSync(releaseDirectory, { withFileTypes: true })) {
      if (
        entry.isFile() &&
        entry.name !== 'builder-debug.yml' &&
        /\.(exe|deb|AppImage|blockmap|yml)$/.test(entry.name)
      ) {
        fs.copyFileSync(
          path.join(releaseDirectory, entry.name),
          path.join(stagingDirectory, entry.name),
        );
      }
    }

    assert.equal(fs.existsSync(stagedArtifact), true);
    assert.equal(fs.existsSync(path.join(stagingDirectory, 'builder-debug.yml')), false);
    assert.equal(fs.existsSync(path.join(stagingDirectory, 'win-unpacked')), false);
  } finally {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  }
});
