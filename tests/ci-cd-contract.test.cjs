const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const { normalizeChecksumText, prepareReleaseStaging, verifyChecksumManifest } = require(
  path.join(root, 'scripts', 'prepare-release-staging.cjs'),
);

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
  const stagingScript = read('scripts/prepare-release-staging.cjs');
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s+(push|pull_request):/m);
  assert.match(workflow, /github\.actor == 'edarkea'/);
  assert.match(workflow, /ATOMIC_RELEASE_PUBLISHERS/);
  assert.match(workflow, /needs: validate/);
  assert.match(workflow, /Read package version/);
  assert.match(workflow, /steps\.metadata\.outputs\.version/);
  assert.match(
    workflow,
    /git -c user\.name='github-actions\[bot\]'[\s\\]+-c user\.email='41898282\+github-actions\[bot\]@users\.noreply\.github\.com'[\s\\]+tag --annotate/,
  );
  assert.match(workflow, /git cat-file -t "refs\/tags\/\$RELEASE_TAG"\)" = tag/);
  assert.match(workflow, /git rev-parse "refs\/tags\/\$RELEASE_TAG\^\{\}"\)" = "\$RELEASE_SHA"/);
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
  assert.match(stagingScript, /artifact name collision/);
  assert.match(stagingScript, /builder-debug/);
  assert.match(stagingScript, /win-unpacked/);
  assert.match(stagingScript, /linux-unpacked/);
  assert.match(stagingScript, /verifyUpdateManifest/);
  assert.match(stagingScript, /globalManifest/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /gh release view "\$RELEASE_TAG" --repo "\$GITHUB_REPOSITORY"/);
  assert.match(workflow, /gh release create "\$RELEASE_TAG" "\$\{release_files\[@\]\}"/);
  assert.doesNotMatch(workflow, /cp release\/windows\/\* release\/linux\/\* release\//);
  assert.doesNotMatch(workflow, /gh release create "\$RELEASE_TAG" release\/\*/);
  assert.doesNotMatch(workflow, /inputs\.(version|tag|ref)/);
  assert.match(workflow, /\[System\.IO\.File\]::WriteAllText/);
  assert.match(workflow, /\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(stagingScript, /normalizeChecksumManifest/);
  assert.match(stagingScript, /normalizeChecksumText/);
  assert.match(workflow, /release_status/);
  assert.match(workflow, /node scripts\/prepare-release-staging\.cjs/);
  assert.match(stagingScript, /copyOptionalPattern\(linuxDirectory, \/\\\.blockmap\$\//);
  assert.match(stagingScript, /copyRequiredPattern\(linuxDirectory, \/\\\.deb\$\//);
  assert.match(stagingScript, /copyRequiredPattern\(linuxDirectory, \/\\\.AppImage\$\//);
  assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);
  assert.equal(packageLock.packages[''].version, packageJson.version);
});

test('release tag uses explicit bot identity without runner Git configuration', () => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-git-tag-'));
  const gitEnvironment = {
    ...process.env,
    GIT_CONFIG_GLOBAL: path.join(rootDirectory, 'missing-global-config'),
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (args) =>
    execFileSync('git', args, { cwd: rootDirectory, env: gitEnvironment, encoding: 'utf8' }).trim();

  try {
    git(['init', '--quiet']);
    git([
      '-c',
      'user.name=fixture-commit',
      '-c',
      'user.email=fixture-commit@example.invalid',
      'commit',
      '--allow-empty',
      '--message',
      'approved release commit',
    ]);
    assert.throws(() => git(['config', '--local', '--get', 'user.name']), /Command failed/);

    const approvedSha = git(['rev-parse', 'HEAD']);
    git([
      '-c',
      'user.name=github-actions[bot]',
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      'tag',
      '--annotate',
      'v0.0.1',
      approvedSha,
      '--message',
      'Atomic Chat v0.0.1',
    ]);

    assert.equal(git(['cat-file', '-t', 'refs/tags/v0.0.1']), 'tag');
    assert.equal(git(['rev-parse', 'refs/tags/v0.0.1^{}']), approvedSha);
    const tagger = git([
      'for-each-ref',
      '--format=%(taggername)\t%(taggeremail)',
      'refs/tags/v0.0.1',
    ]);
    assert.equal(
      tagger,
      'github-actions[bot]\t<41898282+github-actions[bot]@users.noreply.github.com>',
    );
  } finally {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  }
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
        normalizeChecksumText(fs.readFileSync(sourceManifest, 'utf8')),
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

test('release staging accepts optional Linux blockmaps and rejects invalid inputs', () => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-staging-'));
  const sha256 = (filePath) =>
    crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  const writeSampleRelease = (name, includeLinuxBlockmap) => {
    const baseDirectory = path.join(rootDirectory, name);
    const windowsDirectory = path.join(baseDirectory, 'windows');
    const linuxDirectory = path.join(baseDirectory, 'linux');
    const stagingDirectory = path.join(baseDirectory, 'publish');
    fs.mkdirSync(windowsDirectory, { recursive: true });
    fs.mkdirSync(linuxDirectory, { recursive: true });
    const write = (directory, fileName, contents) =>
      fs.writeFileSync(path.join(directory, fileName), contents);

    write(windowsDirectory, 'Atomic Chat Setup 0.0.1.exe', 'windows installer');
    write(windowsDirectory, 'Atomic Chat Setup 0.0.1.exe.blockmap', 'windows blockmap');
    write(
      windowsDirectory,
      'latest.yml',
      'version: 0.0.1\nfiles:\n  - url: Atomic Chat Setup 0.0.1.exe\npath: Atomic Chat Setup 0.0.1.exe\n',
    );
    write(windowsDirectory, 'builder-debug.yml', 'debug');
    fs.mkdirSync(path.join(windowsDirectory, 'win-unpacked'));

    write(linuxDirectory, 'atomic-chat-0.0.1.AppImage', 'linux appimage');
    write(linuxDirectory, 'atomic-chat_0.0.1_amd64.deb', 'linux deb');
    write(
      linuxDirectory,
      'latest-linux.yml',
      'version: 0.0.1\nfiles:\n  - url: atomic-chat-0.0.1.AppImage\npath: atomic-chat-0.0.1.AppImage\n',
    );
    if (includeLinuxBlockmap) {
      write(linuxDirectory, 'atomic-chat-0.0.1.AppImage.blockmap', 'linux blockmap');
    }
    write(linuxDirectory, 'builder-debug.yml', 'debug');
    fs.mkdirSync(path.join(linuxDirectory, 'linux-unpacked'));

    for (const directory of [windowsDirectory, linuxDirectory]) {
      const lines = fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS.txt')
        .map((entry) => `${sha256(path.join(directory, entry.name))}  ${entry.name}`)
        .sort();
      write(directory, 'SHA256SUMS.txt', `${lines.join('\n')}\n`);
    }
    return { windowsDirectory, linuxDirectory, stagingDirectory };
  };

  try {
    const withoutLinuxBlockmap = writeSampleRelease('without-blockmap', false);
    const resultWithoutBlockmap = prepareReleaseStaging({
      ...withoutLinuxBlockmap,
      version: '0.0.1',
    });
    assert.equal(
      resultWithoutBlockmap.linuxArtifacts.includes('atomic-chat-0.0.1.AppImage.blockmap'),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(withoutLinuxBlockmap.stagingDirectory, 'atomic-chat-0.0.1.AppImage')),
      true,
    );
    assert.equal(
      fs.existsSync(
        path.join(withoutLinuxBlockmap.stagingDirectory, 'atomic-chat_0.0.1_amd64.deb'),
      ),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(withoutLinuxBlockmap.stagingDirectory, 'latest-linux.yml')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(withoutLinuxBlockmap.stagingDirectory, 'builder-debug.yml')),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(withoutLinuxBlockmap.stagingDirectory, 'linux-unpacked')),
      false,
    );
    verifyChecksumManifest(
      path.join(withoutLinuxBlockmap.stagingDirectory, 'SHA256SUMS-0.0.1.txt'),
      withoutLinuxBlockmap.stagingDirectory,
    );

    const withLinuxBlockmap = writeSampleRelease('with-blockmap', true);
    const resultWithBlockmap = prepareReleaseStaging({ ...withLinuxBlockmap, version: '0.0.1' });
    assert.equal(
      resultWithBlockmap.linuxArtifacts.includes('atomic-chat-0.0.1.AppImage.blockmap'),
      true,
    );

    const altered = writeSampleRelease('altered', false);
    fs.writeFileSync(path.join(altered.linuxDirectory, 'atomic-chat-0.0.1.AppImage'), 'altered');
    assert.throws(
      () => prepareReleaseStaging({ ...altered, version: '0.0.1' }),
      /checksum mismatch/,
    );

    const missing = writeSampleRelease('missing', false);
    fs.unlinkSync(path.join(missing.linuxDirectory, 'atomic-chat_0.0.1_amd64.deb'));
    assert.throws(
      () => prepareReleaseStaging({ ...missing, version: '0.0.1' }),
      /missing checksum artifact/,
    );

    const invalidReference = writeSampleRelease('invalid-reference', false);
    fs.writeFileSync(
      path.join(invalidReference.linuxDirectory, 'latest-linux.yml'),
      'version: 0.0.1\nfiles:\n  - url: missing.AppImage\npath: missing.AppImage\n',
    );
    const invalidManifestLines = fs
      .readdirSync(invalidReference.linuxDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name !== 'SHA256SUMS.txt')
      .map(
        (entry) =>
          `${sha256(path.join(invalidReference.linuxDirectory, entry.name))}  ${entry.name}`,
      )
      .sort();
    fs.writeFileSync(
      path.join(invalidReference.linuxDirectory, 'SHA256SUMS.txt'),
      `${invalidManifestLines.join('\n')}\n`,
    );
    assert.throws(
      () => prepareReleaseStaging({ ...invalidReference, version: '0.0.1' }),
      /update manifest references a missing artifact/,
    );
  } finally {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  }
});
