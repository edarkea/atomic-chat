async function persistCompletedTransfer({ record, direction, media, fileHistory }) {
  const sourcePath = direction === 'incoming' ? record?.destination : record?.sourcePath;
  const isCandidate =
    typeof media?.isStaticImageCandidate === 'function' &&
    (await media.isStaticImageCandidate(sourcePath));
  const mediaRecord = isCandidate
    ? await media.persistTransfer(record, direction)
    : null;
  if (!mediaRecord) await fileHistory.persistTransfer(record, direction);
  return mediaRecord;
}

module.exports = { persistCompletedTransfer };
