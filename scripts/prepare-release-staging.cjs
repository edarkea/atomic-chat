'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizeChecksumText(contents) {
  return contents.replace(/\r+(?:\n|$)/g, '\n').replace(/\r+(?=[0-9A-Fa-f]{64}  )/g, '\n');
}

function normalizeChecksumManifest(manifestPath) {
  const normalized = normalizeChecksumText(fs.readFileSync(manifestPath, 'utf8'));
  fs.writeFileSync(manifestPath, normalized, 'utf8');
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyChecksumManifest(manifestPath, baseDirectory) {
  const lines = fs
    .readFileSync(manifestPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  const base = path.resolve(baseDirectory);

  if (lines.length === 0) {
    throw new Error(`checksum manifest is empty: ${manifestPath}`);
  }

  for (const line of lines) {
    const match = /^([0-9a-f]{64})  (.+)$/.exec(line);
    if (!match) {
      throw new Error(`invalid checksum line: ${line}`);
    }
    const filePath = path.resolve(base, match[2]);
    const relative = path.relative(base, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`checksum path escapes its directory: ${match[2]}`);
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`missing checksum artifact: ${match[2]}`);
    }
    const actualHash = sha256(filePath);
    if (actualHash !== match[1]) {
      throw new Error(`checksum mismatch: ${match[2]}`);
    }
  }
}

function sortedFiles(directory, pattern) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

function copyArtifact(sourceDirectory, artifactName, stagingDirectory, platformArtifacts) {
  const sourcePath = path.join(sourceDirectory, artifactName);
  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    throw new Error(`missing required artifact: ${sourcePath}`);
  }
  const destinationPath = path.join(stagingDirectory, artifactName);
  if (fs.existsSync(destinationPath)) {
    throw new Error(`artifact name collision: ${artifactName}`);
  }
  fs.copyFileSync(sourcePath, destinationPath);
  platformArtifacts.push(artifactName);
}

function copyRequiredPattern(sourceDirectory, pattern, stagingDirectory, platformArtifacts) {
  const files = sortedFiles(sourceDirectory, pattern);
  if (files.length === 0) {
    throw new Error(`no required artifact found in ${sourceDirectory}`);
  }
  for (const file of files) {
    copyArtifact(sourceDirectory, file, stagingDirectory, platformArtifacts);
  }
}

function copyOptionalPattern(sourceDirectory, pattern, stagingDirectory, platformArtifacts) {
  for (const file of sortedFiles(sourceDirectory, pattern)) {
    copyArtifact(sourceDirectory, file, stagingDirectory, platformArtifacts);
  }
}

function verifyUpdateManifest(manifestPath, stagingDirectory) {
  const references = [
    ...fs.readFileSync(manifestPath, 'utf8').matchAll(/^\s*(?:url|path):\s*(.+?)\s*$/gm),
  ].map((match) => match[1].replace(/^"|"$/g, ''));
  if (references.length === 0) {
    throw new Error(`update manifest has no artifact references: ${manifestPath}`);
  }
  for (const reference of references) {
    if (reference.startsWith('/') || reference.includes('/') || reference.startsWith('.')) {
      throw new Error(`invalid staged path in update manifest: ${reference}`);
    }
    const filePath = path.join(stagingDirectory, reference);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`update manifest references a missing artifact: ${reference}`);
    }
  }
}

function writeChecksumManifest(manifestPath, baseDirectory, artifactNames) {
  const sortedNames = [...artifactNames].sort();
  if (sortedNames.length === 0) {
    throw new Error(`cannot create empty checksum manifest: ${manifestPath}`);
  }
  const contents = `${sortedNames.map((name) => `${sha256(path.join(baseDirectory, name))}  ${name}`).join('\n')}\n`;
  fs.writeFileSync(manifestPath, contents, 'utf8');
  verifyChecksumManifest(manifestPath, baseDirectory);
}

function prepareReleaseStaging({ windowsDirectory, linuxDirectory, stagingDirectory, version }) {
  const windowsManifest = path.join(windowsDirectory, 'SHA256SUMS.txt');
  const linuxManifest = path.join(linuxDirectory, 'SHA256SUMS.txt');
  normalizeChecksumManifest(windowsManifest);
  verifyChecksumManifest(windowsManifest, windowsDirectory);
  verifyChecksumManifest(linuxManifest, linuxDirectory);

  fs.rmSync(stagingDirectory, { recursive: true, force: true });
  fs.mkdirSync(stagingDirectory, { recursive: true });
  const windowsArtifacts = [];
  const linuxArtifacts = [];

  copyArtifact(windowsDirectory, 'latest.yml', stagingDirectory, windowsArtifacts);
  copyRequiredPattern(windowsDirectory, /\.exe$/, stagingDirectory, windowsArtifacts);
  copyOptionalPattern(windowsDirectory, /\.blockmap$/, stagingDirectory, windowsArtifacts);
  copyArtifact(linuxDirectory, 'latest-linux.yml', stagingDirectory, linuxArtifacts);
  copyRequiredPattern(linuxDirectory, /\.deb$/, stagingDirectory, linuxArtifacts);
  copyRequiredPattern(linuxDirectory, /\.AppImage$/, stagingDirectory, linuxArtifacts);
  copyOptionalPattern(linuxDirectory, /\.blockmap$/, stagingDirectory, linuxArtifacts);

  for (const entry of fs.readdirSync(stagingDirectory, { withFileTypes: true })) {
    if (!entry.isFile() || /^(builder-debug\.yml|win-unpacked|linux-unpacked)$/.test(entry.name)) {
      throw new Error(`invalid file in release staging: ${entry.name}`);
    }
  }

  verifyUpdateManifest(path.join(stagingDirectory, 'latest.yml'), stagingDirectory);
  verifyUpdateManifest(path.join(stagingDirectory, 'latest-linux.yml'), stagingDirectory);

  writeChecksumManifest(
    path.join(stagingDirectory, 'SHA256SUMS-windows-x64.txt'),
    stagingDirectory,
    windowsArtifacts,
  );
  writeChecksumManifest(
    path.join(stagingDirectory, 'SHA256SUMS-linux-x64.txt'),
    stagingDirectory,
    linuxArtifacts,
  );

  const globalManifest = `SHA256SUMS-${version}.txt`;
  const finalArtifacts = fs
    .readdirSync(stagingDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== globalManifest)
    .map((entry) => entry.name)
    .sort();
  writeChecksumManifest(
    path.join(stagingDirectory, globalManifest),
    stagingDirectory,
    finalArtifacts,
  );

  return { globalManifest, linuxArtifacts, windowsArtifacts };
}

if (require.main === module) {
  const [, , windowsDirectory, linuxDirectory, stagingDirectory, version] = process.argv;
  if (!windowsDirectory || !linuxDirectory || !stagingDirectory || !version) {
    console.error('usage: prepare-release-staging.cjs <windows> <linux> <staging> <version>');
    process.exitCode = 2;
  } else {
    try {
      prepareReleaseStaging({ windowsDirectory, linuxDirectory, stagingDirectory, version });
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}

module.exports = {
  normalizeChecksumManifest,
  normalizeChecksumText,
  prepareReleaseStaging,
  verifyChecksumManifest,
};
