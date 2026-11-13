'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  analyzeBrowserStats,
  packageFromInput,
  outputBasename,
  resolveBrowserStatsFile,
} = require('../scripts/perf/analyze-browser-stats.cjs');

test('groups output contributions without treating lazy chunks as initial size', () => {
  const result = analyzeBrowserStats({
    outputs: {
      'dist/browser/main-AB123.js': {
        bytes: 800,
        entryPoint: 'src/main.ts',
        inputs: {
          'src/main.ts': { bytesInOutput: 20 },
          'src/app/app.ts': { bytesInOutput: 100 },
          'node_modules/@angular/core/fesm2022/core.mjs': { bytesInOutput: 500 },
          'node_modules/tslib/tslib.es6.mjs': { bytesInOutput: 30 },
        },
      },
      'dist/browser/chunk-A1.js': {
        bytes: 400,
        inputs: { 'src/app/sticker-studio.component.ts': { bytesInOutput: 350 } },
      },
      'dist/browser/styles-ABC.css': { bytes: 100 },
    },
  });
  assert.equal(result.main.bytes, 800);
  assert.equal(result.totalAttributedBytes, 650);
  assert.equal(result.modules[0].name, 'node_modules/@angular/core/fesm2022/core.mjs');
  assert.deepEqual(
    result.packages.map((p) => p.name),
    ['@angular/core', '[atomic-chat / app]', 'tslib'],
  );
  assert.deepEqual(
    result.chunks.map((p) => p.filename),
    ['main-AB123.js', 'chunk-A1.js'],
  );
});

test('preserves path handling for scoped packages and Windows separators', () => {
  assert.equal(
    packageFromInput('C:\\app\\node_modules\\@angular\\common\\x.js'),
    '@angular/common',
  );
  assert.equal(outputBasename('dist\\browser\\main-XYZ.js'), 'main-XYZ.js');
  assert.equal(packageFromInput('src/app/app.ts'), '[atomic-chat / app]');
});

test('accepts an entryPoint main chunk with an unexpected output filename', () => {
  const result = analyzeBrowserStats({
    outputs: {
      'dist/browser/app-entry.js': {
        bytes: 20,
        entryPoint: 'src/main.ts',
        inputs: { 'src/main.ts': { bytesInOutput: 12 } },
      },
    },
  });
  assert.equal(result.main.name, 'app-entry.js');
});

test('rejects missing and malformed stats instead of fabricating size estimates', () => {
  assert.throws(() => analyzeBrowserStats({}), /esbuild metafile/);
  assert.throws(() => analyzeBrowserStats({ outputs: {} }), /No initial main/);
  assert.throws(
    () =>
      analyzeBrowserStats({
        outputs: {
          'dist/browser/main.js': { bytes: 'not a number' },
        },
      }),
    /No initial main/,
  );
});

function createStatsDirectory(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-bundle-stats-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('locates Angular 21 stats.json at the output root by default layout', (t) => {
  const root = createStatsDirectory(t);
  const expected = path.join(root, 'stats.json');
  fs.writeFileSync(expected, '{"outputs":{}}');
  assert.equal(resolveBrowserStatsFile(root), expected);
});

test('locates stats.json inside the browser subdirectory when configured that way', (t) => {
  const root = createStatsDirectory(t);
  const expected = path.join(root, 'browser', 'stats.json');
  fs.mkdirSync(path.dirname(expected));
  fs.writeFileSync(expected, '{"outputs":{}}');
  assert.equal(resolveBrowserStatsFile(root), expected);
});

test('locates newer browser-stats.json in the root or browser subdirectory', (t) => {
  const root = createStatsDirectory(t);
  const expected = path.join(root, 'browser-stats.json');
  fs.writeFileSync(expected, '{"outputs":{}}');
  assert.equal(resolveBrowserStatsFile(root), expected);
  fs.rmSync(expected);
  const nested = path.join(root, 'browser', 'browser-stats.json');
  fs.mkdirSync(path.dirname(nested));
  fs.writeFileSync(nested, '{"outputs":{}}');
  assert.equal(resolveBrowserStatsFile(root), nested);
});

test('recovers from the old browser/browser-stats.json hint against Angular 21 output', (t) => {
  const root = createStatsDirectory(t);
  const actual = path.join(root, 'stats.json');
  fs.writeFileSync(actual, '{"outputs":{}}');
  assert.equal(resolveBrowserStatsFile(path.join(root, 'browser', 'browser-stats.json')), actual);
});

test('accepts an existing explicitly named stats file before fallback discovery', (t) => {
  const root = createStatsDirectory(t);
  const exact = path.join(root, 'custom-build.json');
  const defaultStats = path.join(root, 'stats.json');
  fs.writeFileSync(exact, '{"outputs":{}}');
  fs.writeFileSync(defaultStats, '{"outputs":{}}');
  assert.equal(resolveBrowserStatsFile(exact), exact);
});

test('fails clearly when no known stats exist, without inventing bundle data', (t) => {
  const root = createStatsDirectory(t);
  assert.throws(
    () => resolveBrowserStatsFile(root),
    (error) =>
      error.message.includes('No Angular browser stats found') &&
      error.message.includes(path.join(root, 'stats.json')) &&
      error.message.includes('npx ng build --configuration production --stats-json'),
  );
  assert.throws(
    () => resolveBrowserStatsFile(path.join(root, 'made-up.json')),
    /Statistics file does not exist/,
  );
});

test('includes shared static imports in initial JS while excluding dynamic chunks', () => {
  const result = analyzeBrowserStats({
    outputs: {
      'dist/browser/main-ABC.js': {
        bytes: 100,
        entryPoint: 'src/main.ts',
        imports: [
          { path: 'dist/browser/chunk-shared.js', kind: 'import-statement' },
          { path: 'dist/browser/chunk-lazy.js', kind: 'dynamic-import' },
        ],
        inputs: { 'src/main.ts': { bytesInOutput: 30 } },
      },
      'dist/browser/chunk-shared.js': {
        bytes: 200,
        inputs: { 'node_modules/@angular/core/test.mjs': { bytesInOutput: 180 } },
      },
      'dist/browser/chunk-lazy.js': {
        bytes: 400,
        inputs: { 'src/app/theme-studio.component.ts': { bytesInOutput: 350 } },
      },
    },
  });
  assert.equal(result.main.bytes, 100);
  assert.equal(result.initialJsBytes, 300);
  assert.equal(result.initialJsChunks.length, 2);
  assert.equal(result.initialAttributedBytes, 210);
  assert.equal(result.initialPackages[0].name, '@angular/core');
  assert.equal(result.chunks.find((x) => x.filename === 'chunk-lazy.js').reachableFromMain, false);
  assert.equal(result.unresolvedStaticImports.length, 0);
});

test('resolves relative static chunk paths and avoids counting repeated imports twice', () => {
  const result = analyzeBrowserStats({
    outputs: {
      'dist/browser/main.js': {
        bytes: 50,
        imports: [
          { path: './chunk-A.js', kind: 'import-statement' },
          { path: 'chunk-A.js', kind: 'import-statement' },
        ],
      },
      'dist/browser/chunk-A.js': {
        bytes: 70,
        imports: [{ path: './main.js', kind: 'import-statement' }],
      },
    },
  });
  assert.equal(result.initialJsBytes, 120);
  assert.deepEqual(
    result.initialJsChunks.map((x) => x.filename),
    ['chunk-A.js', 'main.js'],
  );
  assert.equal(result.unresolvedStaticImports.length, 0);
});

test('supports paths with Windows separators and reports unresolved static imports', () => {
  const result = analyzeBrowserStats({
    outputs: {
      'dist\\browser\\main.js': {
        bytes: 50,
        imports: [
          { path: 'dist\\browser\\chunk-READY.js', kind: 'import-statement' },
          { path: './chunk-MISSING.js', kind: 'import-statement' },
          { path: './chunk-DYNAMIC.js', kind: 'dynamic-import' },
          { path: './external.js', kind: 'import-statement', external: true },
        ],
      },
      'dist\\browser\\chunk-READY.js': { bytes: 30 },
    },
  });
  assert.equal(result.initialJsBytes, 80);
  assert.deepEqual(result.unresolvedStaticImports, [
    { importer: 'main.js', target: './chunk-MISSING.js' },
  ]);
});

test('does not treat unrelated JavaScript entry points as statically initial', () => {
  const result = analyzeBrowserStats({
    outputs: {
      'dist/main.js': { bytes: 25, inputs: { 'src/main.ts': { bytesInOutput: 10 } } },
      'dist/another-entry.js': { bytes: 100, entryPoint: 'src/other.ts' },
      'dist/styles.css': { bytes: 300 },
    },
  });
  assert.equal(result.initialJsBytes, 25);
  assert.equal(result.initialJsChunks.length, 1);
  assert.equal(
    result.chunks.find((c) => c.filename === 'another-entry.js').reachableFromMain,
    false,
  );
});

test('reports lazy entry boundaries and marks tiny re-export-like chunks without initial savings', () => {
  const result = analyzeBrowserStats({
    outputs: {
      'dist/browser/main.js': {
        bytes: 100,
        imports: [
          { path: './chunk-shared.js', kind: 'import-statement' },
          { path: './chunk-tiny.js', kind: 'dynamic-import' },
          { path: './chunk-full.js', kind: 'dynamic-import' },
          { path: './unbundled-external.js', kind: 'dynamic-import', external: true },
        ],
      },
      'dist/browser/chunk-shared.js': {
        bytes: 200,
        imports: [{ path: './chunk-tiny.js', kind: 'dynamic-import' }],
      },
      'dist/browser/chunk-tiny.js': { bytes: 98 },
      'dist/browser/chunk-full.js': { bytes: 2400 },
    },
  });
  assert.equal(result.initialJsBytes, 300);
  assert.equal(result.initialJsChunks.length, 2);
  assert.deepEqual(result.lazyBoundaries, [
    { filename: 'chunk-full.js', bytes: 2400, importers: ['main.js'], tiny: false },
    { filename: 'chunk-tiny.js', bytes: 98, importers: ['chunk-shared.js', 'main.js'], tiny: true },
  ]);
});

test('does not report nested lazy-only imports as startup boundaries', () => {
  const result = analyzeBrowserStats({
    outputs: {
      'dist\\browser\\main.js': {
        bytes: 100,
        imports: [{ path: './chunk-lazy.js', kind: 'dynamic-import' }],
      },
      'dist\\browser\\chunk-lazy.js': {
        bytes: 1800,
        imports: [{ path: './chunk-nested.js', kind: 'dynamic-import' }],
      },
      'dist\\browser\\chunk-nested.js': { bytes: 45 },
      'dist\\browser\\unrelated.js': {
        bytes: 20,
        imports: [{ path: './chunk-nested.js', kind: 'dynamic-import' }],
      },
    },
  });
  assert.deepEqual(result.lazyBoundaries, [
    { filename: 'chunk-lazy.js', bytes: 1800, importers: ['main.js'], tiny: false },
  ]);
  assert.equal(result.initialJsBytes, 100);
});
