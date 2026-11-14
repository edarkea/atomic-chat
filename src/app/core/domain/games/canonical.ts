const SHA256_CONSTANTS = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const);

const SHA256_INITIAL_STATE = Object.freeze([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const);

const HEX = '0123456789abcdef';

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount));
}

function utf8Encode(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function encodeCanonicalFields(fields: readonly string[]): Uint8Array {
  const encoded = fields.map(utf8Encode);
  const byteLength = encoded.reduce((total, field) => total + 4 + field.byteLength, 0);
  const output = new Uint8Array(byteLength);
  const view = new DataView(output.buffer);
  let offset = 0;
  for (const field of encoded) {
    if (field.byteLength > 0xffffffff) throw new RangeError('Canonical field is too large');
    view.setUint32(offset, field.byteLength);
    offset += 4;
    output.set(field, offset);
    offset += field.byteLength;
  }
  return output;
}

export function bytesToHex(bytes: Uint8Array): string {
  let output = '';
  for (const byte of bytes) output += HEX[byte >>> 4] + HEX[byte & 0x0f];
  return output;
}

export function sha256(bytes: Uint8Array): Uint8Array {
  const bitLength = bytes.byteLength * 8;
  const paddedLength = Math.ceil((bytes.byteLength + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.byteLength] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0);

  const state: number[] = [...SHA256_INITIAL_STATE];
  const schedule = new Uint32Array(64);
  for (let blockOffset = 0; blockOffset < paddedLength; blockOffset += 64) {
    for (let index = 0; index < 16; index++)
      schedule[index] = paddedView.getUint32(blockOffset + index * 4);
    for (let index = 16; index < 64; index++) {
      const valueA = schedule[index - 15];
      const valueB = schedule[index - 2];
      const smallSigmaA = rotateRight(valueA, 7) ^ rotateRight(valueA, 18) ^ (valueA >>> 3);
      const smallSigmaB = rotateRight(valueB, 17) ^ rotateRight(valueB, 19) ^ (valueB >>> 10);
      schedule[index] =
        (schedule[index - 16] + smallSigmaA + schedule[index - 7] + smallSigmaB) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const bigSigmaA = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + bigSigmaA + choice + SHA256_CONSTANTS[index] + schedule[index]) >>> 0;
      const bigSigmaB = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (bigSigmaB + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0;
    state[1] = (state[1] + b) >>> 0;
    state[2] = (state[2] + c) >>> 0;
    state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0;
    state[5] = (state[5] + f) >>> 0;
    state[6] = (state[6] + g) >>> 0;
    state[7] = (state[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  state.forEach((value, index) => digestView.setUint32(index * 4, value));
  return digest;
}

export function hashCanonicalFields(fields: readonly string[]): string {
  return bytesToHex(sha256(encodeCanonicalFields(fields)));
}

export function serializeCanonicalFields(fields: readonly string[]): string {
  return bytesToHex(encodeCanonicalFields(fields));
}
