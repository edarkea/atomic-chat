const path = require('node:path');

const DEFAULT_DOWNLOAD_DIRECTORY_NAME = 'Downloads';
const MAX_DOWNLOAD_DIRECTORY_LENGTH = 4096;

function isDownloadDirectory(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_DOWNLOAD_DIRECTORY_LENGTH &&
    !value.includes('\0') &&
    path.isAbsolute(value)
  );
}

function normalizeDownloadDirectory(value, fallback) {
  return isDownloadDirectory(value) ? path.normalize(value) : fallback;
}

module.exports = {
  DEFAULT_DOWNLOAD_DIRECTORY_NAME,
  isDownloadDirectory,
  normalizeDownloadDirectory,
};
