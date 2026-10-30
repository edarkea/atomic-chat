const MAX_PREVIEW_BYTES = 10 * 1024 * 1024;
const MAX_PREVIEW_DIMENSION = 4096;
const MAX_PREVIEW_PIXELS = 16_777_216;
const PREVIEW_CHUNK_SIZE = 64 * 1024;

/** @typedef {Error & {code: string}} PreviewError */

/**
 * @param {string} code
 * @param {string} message
 * @returns {PreviewError}
 */
function previewError(code, message) {
  const error = /** @type {PreviewError} */ (new Error(message));
  error.code = code;
  return error;
}

function assertDimensions(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_PREVIEW_DIMENSION ||
    height > MAX_PREVIEW_DIMENSION ||
    width * height > MAX_PREVIEW_PIXELS
  )
    throw previewError('MEDIA_DIMENSIONS_INVALID', 'las dimensiones de la imagen no están permitidas');
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(buffer) {
  if (buffer.length < 33) throw previewError('MEDIA_DECODE_FAILED', 'PNG truncado');
  let offset = 8;
  let width;
  let height;
  let sawIend = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const end = offset + 12 + length;
    if (end > buffer.length) throw previewError('MEDIA_DECODE_FAILED', 'PNG truncado');
    if (type === 'IHDR' && length >= 8) {
      width = buffer.readUInt32BE(offset + 8);
      height = buffer.readUInt32BE(offset + 12);
    }
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    const actualCrc = crc32(buffer.subarray(offset + 4, offset + 8 + length));
    if (expectedCrc !== actualCrc) throw previewError('MEDIA_DECODE_FAILED', 'CRC PNG inválido');
    if (type === 'acTL') throw previewError('MEDIA_TYPE_UNSUPPORTED', 'PNG animado no permitido');
    if (type === 'IEND') {
      sawIend = true;
      break;
    }
    offset = end;
  }
  if (!sawIend) throw previewError('MEDIA_DECODE_FAILED', 'PNG sin IEND');
  assertDimensions(width, height);
  return { mimeType: 'image/png', width, height };
}

function isJpegSof(marker) {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function inspectJpeg(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8)
    throw previewError('MEDIA_TYPE_UNSUPPORTED', 'formato de imagen no permitido');
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2 || offset + length > buffer.length)
      throw previewError('MEDIA_DECODE_FAILED', 'JPEG truncado');
    if (isJpegSof(marker)) {
      if (length < 7) throw previewError('MEDIA_DECODE_FAILED', 'JPEG sin dimensiones');
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      assertDimensions(width, height);
      return { mimeType: 'image/jpeg', width, height };
    }
    offset += length;
  }
  throw previewError('MEDIA_DECODE_FAILED', 'JPEG sin dimensiones');
}

function inspectStaticImage(buffer, decoder) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4)
    throw previewError('MEDIA_DECODE_FAILED', 'archivo de imagen vacío o truncado');
  if (buffer.length > MAX_PREVIEW_BYTES)
    throw previewError('MEDIA_SIZE_EXCEEDED', 'la imagen supera el tamaño permitido');
  const signature =
    buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const parsed = signature ? inspectPng(buffer) : inspectJpeg(buffer);
  if (!decoder || typeof decoder.createFromBuffer !== 'function')
    throw previewError('MEDIA_DECODE_FAILED', 'no hay decodificador nativo disponible');
  const image = decoder.createFromBuffer(buffer);
  if (!image || image.isEmpty()) throw previewError('MEDIA_DECODE_FAILED', 'imagen no decodificable');
  const size = image.getSize();
  assertDimensions(size.width, size.height);
  if (size.width !== parsed.width || size.height !== parsed.height)
    throw previewError('MEDIA_DECODE_FAILED', 'las dimensiones no coinciden con el archivo');
  return { ...parsed, sizeBytes: String(buffer.length) };
}

module.exports = {
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_DIMENSION,
  MAX_PREVIEW_PIXELS,
  PREVIEW_CHUNK_SIZE,
  inspectStaticImage,
  previewError,
};
