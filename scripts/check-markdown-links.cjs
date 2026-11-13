const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const markdownPattern = /\[[^\]]*\]\((<[^>]+>|[^)\s]+)(?:\s+["'][^)]*["'])?\)/g;

function markdownFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (['.git', 'node_modules', 'dist', 'coverage'].includes(entry.name)) return [];
      return markdownFiles(absolute);
    }
    return entry.isFile() && entry.name.endsWith('.md') ? [absolute] : [];
  });
}

function localTarget(target) {
  const value = target.startsWith('<') && target.endsWith('>') ? target.slice(1, -1) : target;
  if (/^(?:https?:|mailto:)/i.test(value) || value.startsWith('#')) return undefined;
  return decodeURIComponent(value.split('#', 1)[0]);
}

const failures = [];
const files = markdownFiles(root);
let checkedLinks = 0;
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const match of source.matchAll(markdownPattern)) {
    const target = localTarget(match[1]);
    if (target === undefined) continue;
    checkedLinks += 1;
    const resolved = path.resolve(path.dirname(file), target);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      failures.push(`${path.relative(root, file)} -> ${target} (outside repository)`);
    } else if (!fs.existsSync(resolved)) {
      failures.push(`${path.relative(root, file)} -> ${target}`);
    }
  }
}

if (failures.length) {
  console.error('Markdown link check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Markdown link check passed: ${files.length} files, ${checkedLinks} local links.`);
}
