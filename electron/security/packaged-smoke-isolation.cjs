const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PACKAGED_SMOKE_FLAG = 'ATOMIC_CHAT_PACKAGED_SMOKE';
const PACKAGED_SMOKE_ROOT = 'ATOMIC_CHAT_SMOKE_DATA_ROOT';

function isPathWithin(rootPath, candidatePath) {
  const relativePath = path.relative(rootPath, candidatePath);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

function realPath(fsModule, value) {
  const realpath = fsModule.realpathSync?.native || fsModule.realpathSync;
  return realpath(value);
}

function validatePackagedSmokeRoot(value, { fsModule = fs, temporaryRoot = os.tmpdir() } = {}) {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error('Packaged smoke requires a non-empty temporary data root');
  if (!path.isAbsolute(value)) throw new Error('Packaged smoke data root must be absolute');

  const resolvedRoot = path.resolve(value);
  const resolvedTemporaryRoot = path.resolve(temporaryRoot);
  if (!isPathWithin(resolvedTemporaryRoot, resolvedRoot))
    throw new Error('Packaged smoke data root must be inside the temporary root');

  let rootStats;
  try {
    rootStats = fsModule.lstatSync(resolvedRoot);
  } catch {
    throw new Error('Packaged smoke data root must already exist');
  }
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink())
    throw new Error('Packaged smoke data root must be a real directory');

  let realTemporaryRoot;
  let realRoot;
  try {
    realTemporaryRoot = realPath(fsModule, resolvedTemporaryRoot);
    realRoot = realPath(fsModule, resolvedRoot);
  } catch {
    throw new Error('Packaged smoke data root must resolve to a real path');
  }
  if (!isPathWithin(realTemporaryRoot, realRoot))
    throw new Error('Packaged smoke data root resolves outside the temporary root');

  try {
    fsModule.accessSync(resolvedRoot, fs.constants.W_OK);
  } catch {
    throw new Error('Packaged smoke data root must be writable');
  }

  const applicationDataPath = path.join(resolvedRoot, 'AtomicChat-Data');
  let applicationDataPathExists = false;
  try {
    fsModule.lstatSync(applicationDataPath);
    applicationDataPathExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT')
      throw new Error('Packaged smoke application data path cannot be inspected');
  }
  if (applicationDataPathExists)
    throw new Error('Packaged smoke data root must not contain an existing application data path');

  return Object.freeze({ root: resolvedRoot, applicationDataPath });
}

function resolveApplicationDataPath({
  isPackaged,
  environment = process.env,
  appDataPath,
  portableExecutableDirectory,
  fsModule = fs,
  temporaryRoot = os.tmpdir(),
}) {
  const smokeConfigurationPresent =
    Object.prototype.hasOwnProperty.call(environment, PACKAGED_SMOKE_FLAG) ||
    Object.prototype.hasOwnProperty.call(environment, PACKAGED_SMOKE_ROOT);
  if (smokeConfigurationPresent) {
    if (environment[PACKAGED_SMOKE_FLAG] !== '1')
      throw new Error('Packaged smoke flag must be exactly 1 when smoke configuration is present');
    return validatePackagedSmokeRoot(environment[PACKAGED_SMOKE_ROOT], {
      fsModule,
      temporaryRoot,
    }).applicationDataPath;
  }
  if (isPackaged) return path.join(portableExecutableDirectory || appDataPath, 'AtomicChat-Data');
  return path.join(appDataPath, 'AtomicChat-Dev');
}

module.exports = {
  PACKAGED_SMOKE_FLAG,
  PACKAGED_SMOKE_ROOT,
  isPathWithin,
  resolveApplicationDataPath,
  validatePackagedSmokeRoot,
};
