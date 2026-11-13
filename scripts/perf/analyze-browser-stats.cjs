'use strict';

const fs = require('node:fs');
const path = require('node:path');

function outputBasename(name) {
  return path.posix.basename(name.replaceAll('\\', '/'));
}

function packageFromInput(name) {
  const normalized = name.replaceAll('\\', '/');
  const marker = 'node_modules/';
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return '[atomic-chat / app]';
  const parts = normalized.slice(index + marker.length).split('/');
  if (!parts[0]) return '[unknown dependency]';
  return parts[0].startsWith('@') && parts[1]
    ? `${parts[0]}/${parts[1]}`
    : parts[0];
}

function resolveOutputImport(outputByName, importer, target) {
  const normalizedTarget = target.replaceAll('\\', '/');
  return outputByName.get(normalizedTarget) ||
    outputByName.get(path.posix.normalize(path.posix.join(
      path.posix.dirname(importer.name.replaceAll('\\', '/')), normalizedTarget,
    )));
}

/**
 * Inspect the esbuild metafile emitted by Angular's --stats-json build.
 * All sizes are raw output bytes, not transfer, gzip or exclusive memory.
 */
function analyzeBrowserStats(stats, limit = 15) {
  if (!stats || typeof stats !== 'object' || !stats.outputs ||
      typeof stats.outputs !== 'object') {
    throw new Error('Expected an esbuild metafile containing outputs.');
  }
  const outputs = Object.entries(stats.outputs)
    .filter(([name, output]) => name.endsWith('.js') &&
      output && Number.isFinite(output.bytes))
    .map(([name, output]) => ({
      name,
      filename: outputBasename(name),
      bytes: output.bytes,
      entryPoint: output.entryPoint || null,
      imports: Array.isArray(output.imports) ? output.imports : [],
      inputs: output.inputs || {},
    }));
  const main = outputs.find((item) => /^main(?:-[a-z0-9]+)?\.js$/i.test(item.filename)) ||
    outputs.find((item) => item.entryPoint &&
      /(^|\/)src\/main\.ts$/i.test(item.entryPoint.replaceAll('\\', '/')));
  if (!main) {
    throw new Error('No initial main JS output found; inspect the stats output names.');
  }

  // Walk only the static JavaScript import graph. Dynamic imports are lazy
  // and must not be counted as initial JS; CSS is measured by Angular separately.
  const outputByName = new Map(
    outputs.map((item) => [item.name.replaceAll('\\', '/'), item]),
  );
  const initial = new Set();
  const unresolvedStaticImports = [];
  const pending = [main];
  while (pending.length) {
    const item = pending.pop();
    if (initial.has(item.name)) continue;
    initial.add(item.name);
    for (const imported of item.imports) {
      if (imported.external === true ||
          (imported.kind !== 'import-statement' && imported.kind !== 'require-call') ||
          typeof imported.path !== 'string') {
        continue;
      }
      const target = imported.path.replaceAll('\\', '/');
      const output = resolveOutputImport(outputByName, item, target);
      if (output) {
        if (!initial.has(output.name)) pending.push(output);
      } else if (target.endsWith('.js')) {
        // Never silently classify an unresolved chunk as lazy or initial.
        unresolvedStaticImports.push({ importer: item.filename, target });
      }
    }
  }

  const initialOutputs = outputs.filter((item) => initial.has(item.name));

  // A tiny dynamic entry may only re-export code already present in initial
  // static chunks. This is a diagnostic heuristic, not a build-size saving.
  const lazyBoundaryByName = new Map();
  for (const importer of initialOutputs) {
    for (const imported of importer.imports) {
      if (imported.external === true || imported.kind !== 'dynamic-import' ||
          typeof imported.path !== 'string') continue;
      const target = resolveOutputImport(outputByName, importer, imported.path);
      if (!target || initial.has(target.name)) continue;
      const existing = lazyBoundaryByName.get(target.name);
      if (existing) {
        if (!existing.importers.includes(importer.filename)) {
          existing.importers.push(importer.filename);
        }
      } else {
        lazyBoundaryByName.set(target.name, {
          filename: target.filename,
          bytes: target.bytes,
          importers: [importer.filename],
          tiny: target.bytes < 1024,
        });
      }
    }
  }
  const lazyBoundaries = [...lazyBoundaryByName.values()]
    .map((entry) => ({ ...entry, importers: [...entry.importers].sort() }))
    .sort((a, b) => b.bytes - a.bytes || a.filename.localeCompare(b.filename));

  const initialModules = initialOutputs.flatMap((item) =>
    Object.entries(item.inputs)
      .filter(([, details]) => Number.isFinite(details?.bytesInOutput))
      .map(([name, details]) => ({
        name: name.replaceAll('\\', '/'),
        bytesInOutput: details.bytesInOutput,
        package: packageFromInput(name),
        chunk: item.filename,
      })),
  ).sort((a, b) => b.bytesInOutput - a.bytesInOutput ||
    a.name.localeCompare(b.name));
  const initialByPackage = new Map();
  for (const item of initialModules) {
    initialByPackage.set(
      item.package,
      (initialByPackage.get(item.package) || 0) + item.bytesInOutput,
    );
  }

  const modules = Object.entries(main.inputs)
    .filter(([, details]) => Number.isFinite(details?.bytesInOutput))
    .map(([name, details]) => ({
      name: name.replaceAll('\\', '/'),
      bytesInOutput: details.bytesInOutput,
      package: packageFromInput(name),
    }))
    .sort((a, b) => b.bytesInOutput - a.bytesInOutput || a.name.localeCompare(b.name));
  const byPackage = new Map();
  for (const item of modules) {
    byPackage.set(item.package, (byPackage.get(item.package) || 0) + item.bytesInOutput);
  }
  return {
    main: { name: main.filename, bytes: main.bytes },
    initialJsBytes: initialOutputs.reduce((sum, item) => sum + item.bytes, 0),
    initialJsChunks: initialOutputs
      .map(({ filename, bytes }) => ({ filename, bytes }))
      .sort((a, b) => b.bytes - a.bytes || a.filename.localeCompare(b.filename)),
    initialPackages: [...initialByPackage.entries()]
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
      .slice(0, limit),
    initialModules: initialModules.slice(0, limit),
    initialAttributedBytes: initialModules.reduce((sum, item) => sum + item.bytesInOutput, 0),
    unresolvedStaticImports,
    lazyBoundaries,
    chunks: outputs.sort((a, b) => b.bytes - a.bytes ||
      a.filename.localeCompare(b.filename))
      .map(({ name, filename, bytes, entryPoint }) => ({
        filename, bytes, entryPoint, reachableFromMain: initial.has(name),
      })),
    packages: [...byPackage.entries()]
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name))
      .slice(0, limit),
    modules: modules.slice(0, limit),
    totalAttributedBytes: modules.reduce((total, item) => total + item.bytesInOutput, 0),
  };
}

/**
 * Angular 21 writes stats.json in the build output root. Newer builders may
 * write browser-stats.json, and custom outputPath settings may nest files in
 * browser/. Resolve only known filenames; never scan unrelated directories.
 */
function resolveBrowserStatsFile(requestedPath = path.join('dist', 'atomic-chat')) {
  const absolute = path.resolve(requestedPath);
  if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) return absolute;

  const recognized = new Set(['stats.json', 'browser-stats.json', 'browser-initial-stats.json']);
  const requestedName = path.basename(absolute);
  if (path.extname(absolute).toLowerCase() === '.json' && !recognized.has(requestedName)) {
    throw new Error(`Statistics file does not exist: ${absolute}`);
  }
  let directory = path.extname(absolute).toLowerCase() === '.json'
    ? path.dirname(absolute) : absolute;
  if (path.basename(directory).toLowerCase() === 'browser') {
    directory = path.dirname(directory);
  }

  const candidates = [
    path.join(directory, 'stats.json'),
    path.join(directory, 'browser-stats.json'),
    path.join(directory, 'browser', 'stats.json'),
    path.join(directory, 'browser', 'browser-stats.json'),
    path.join(directory, 'browser-initial-stats.json'),
    path.join(directory, 'browser', 'browser-initial-stats.json'),
  ];
  const result = candidates.find((candidate) =>
    fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (result) return result;
  throw new Error(
    `No Angular browser stats found. Checked:\n${candidates.join('\n')}\n` +
    'Run: npx ng build --configuration production --stats-json',
  );
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function printReport(report) {
  console.log(`Initial main bundle: ${report.main.name} — ${formatKiB(report.main.bytes)} raw`);
  console.log(`Static JS graph from main: ${formatKiB(report.initialJsBytes)} raw across ${report.initialJsChunks.length} chunk(s), excluding CSS`);
  console.log(`Input contribution sum within main: ${formatKiB(report.totalAttributedBytes)} (not a separate bundle)`);
  console.log(`Initial static JS input attribution: ${formatKiB(report.initialAttributedBytes)} (not a separate bundle)`);
  console.log('\nTop contributors across static initial JS chunks:');
  for (const item of report.initialPackages) {
    console.log(`  ${formatKiB(item.bytes).padStart(12)}  ${item.name}`);
  }
  console.log('\nTop input modules across static initial JS chunks:');
  for (const item of report.initialModules) {
    console.log(`  ${formatKiB(item.bytesInOutput).padStart(12)}  ${item.name} [${item.chunk}]`);
  }
  if (report.unresolvedStaticImports.length) {
    console.warn('\nWarning: unresolved static JS imports; initial graph is incomplete:');
    for (const item of report.unresolvedStaticImports) {
      console.warn(`  ${item.importer} -> ${item.target}`);
    }
  }
  console.log('\nTop contributors within main (raw output byte attribution):');
  for (const item of report.packages) {
    console.log(`  ${formatKiB(item.bytes).padStart(12)}  ${item.name}`);
  }
  console.log('\nTop input modules within main:');
  for (const item of report.modules) {
    console.log(`  ${formatKiB(item.bytesInOutput).padStart(12)}  ${item.name}`);
  }
  if (report.lazyBoundaries.length) {
    console.log('\nDynamic import boundaries from static initial JS:');
    for (const entry of report.lazyBoundaries) {
      console.log(`  ${formatKiB(entry.bytes).padStart(12)}  ${entry.filename} <- ${entry.importers.join(', ')}${entry.tiny ? ' [tiny lazy entry: inspect shared static imports]' : ''}`);
    }
    if (report.lazyBoundaries.some((entry) => entry.tiny)) {
      console.warn('Note: a tiny lazy chunk is not proof of code removal. Compare Angular initial raw AND estimated transfer, and check static component imports.');
    }
  }
  console.log('\nJavaScript output chunks (not all necessarily initial):');
  for (const item of report.chunks) {
    console.log(`  ${formatKiB(item.bytes).padStart(12)}  ${item.filename}${item.reachableFromMain ? ' [static initial]' : ' [not statically reachable from main]'}`);
  }
  console.log('\nNote: size attribution is approximate. Compare with Angular initial totals;');
  console.log('verify the total initial size and transfer against Angular CLI, including CSS.');
}

if (require.main === module) {
  const requestedPath = process.argv[2];
  const limitArgument = process.argv[3];
  const limit = limitArgument === undefined ? 15 : Number(limitArgument);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    console.error('Limit must be an integer between 1 and 100.');
    process.exitCode = 1;
  } else {
    try {
      const file = resolveBrowserStatsFile(requestedPath);
      const stats = JSON.parse(fs.readFileSync(file, 'utf8'));
      console.log(`Statistics file: ${file}`);
      printReport(analyzeBrowserStats(stats, limit));
    } catch (error) {
      console.error(`Cannot analyze browser statistics: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

module.exports = { analyzeBrowserStats, packageFromInput, outputBasename, resolveBrowserStatsFile };
