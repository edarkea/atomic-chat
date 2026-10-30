const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { xml } = require('@xmpp/client');
const {
  buildStickerMessage,
  createXmppStickerService,
  parseStickerMessage,
  validateHttpsUrl,
  STICKERS_NS,
  SFS_NS,
  UPLOAD_NS,
  DISCO_INFO_NS,
  DISCO_ITEMS_NS,
  DATAFORM_NS,
  HASHES_NS,
} = require('../electron/xmpp-stickers.cjs');

const hashValue = crypto.createHash('sha256').update('data').digest('hex');

function sticker(overrides = {}) {
  return {
    mimeType: 'image/png',
    sizeBytes: '4',
    width: 1,
    height: 1,
    hashValue,
    name: 'terminal & sticker.png',
    altText: 'A sticker',
    ...overrides,
  };
}

test('E8.5-XMPP-001 serializes static sticker metadata, SFS source and fallback', () => {
  const stanza = buildStickerMessage({
    to: 'bob@example.test',
    clientMessageId: 'client-1',
    sticker: sticker(),
    sourceUrl: 'https://cdn.example.test/sticker.png',
    fallback: 'A sticker',
    packId: 'ignored-by-wire-policy',
  });
  assert.equal(stanza.getChild('sticker', STICKERS_NS).attrs.pack, 'ignored-by-wire-policy');
  const sharing = stanza.getChild('file-sharing', SFS_NS);
  assert.equal(sharing.getChild('file').getChildText('media-type'), 'image/png');
  assert.equal(sharing.getChild('file').getChild('hash', HASHES_NS).attrs.algo, 'sha-256');
  assert.equal(sharing.getChild('sources').getChild('url-data').attrs.target, 'https://cdn.example.test/sticker.png');
  assert.equal(stanza.getChild('fallback').attrs.for, SFS_NS);
  assert.match(stanza.toString(), /terminal &amp; sticker\.png/);
});

test('E8.5-XMPP-002 parses static incoming stickers and rejects non-static sources', () => {
  const stanza = buildStickerMessage({
    to: 'bob@example.test',
    clientMessageId: 'client-2',
    sticker: sticker({ mimeType: 'image/jpeg' }),
    sourceUrl: 'https://cdn.example.test/sticker.jpg',
  });
  stanza.attrs.from = 'alice@example.test/resource';
  const parsed = parseStickerMessage('bob@example.test', stanza);
  assert.equal(parsed.mimeType, 'image/jpeg');
  assert.equal(parsed.conversationId, 'alice@example.test');
  assert.equal(parsed.availability, 'missing');
  const animated = xml('message', { from: 'alice@example.test/resource', id: 'client-3' },
    xml('sticker', { xmlns: STICKERS_NS }),
    xml('file-sharing', { xmlns: SFS_NS },
      xml('file', { xmlns: 'urn:xmpp:file:metadata:0' },
        xml('media-type', {}, 'image/gif'), xml('size', {}, '4'), xml('width', {}, '1'), xml('height', {}, '1'),
        xml('hash', { xmlns: HASHES_NS, algo: 'sha-256' }, Buffer.from(hashValue, 'hex').toString('base64')),
        xml('name', {}, 'animated.gif'),
      ),
      xml('sources', {}, xml('url-data', { xmlns: 'http://jabber.org/protocol/url-data', target: 'https://cdn.example.test/sticker.gif' })),
    ),
  );
  assert.throws(() => parseStickerMessage('bob@example.test', animated), { code: 'MEDIA_TYPE_UNSUPPORTED' });
  assert.throws(() => validateHttpsUrl('https://cdn.example.test/sticker.png?token=secret'), { code: 'UNSUPPORTED' });
});

function mockAdapter() {
  const requests = [];
  const sent = [];
  const session = {
    iqCaller: {
      request: async (request) => {
        requests.push(request);
        if (request.getChild('query', DISCO_ITEMS_NS))
          return xml('iq', { type: 'result' }, xml('query', { xmlns: DISCO_ITEMS_NS }, xml('item', { jid: 'upload.example.test' })));
        if (request.getChild('query', DISCO_INFO_NS))
          return xml('iq', { type: 'result' }, xml('query', { xmlns: DISCO_INFO_NS },
            xml('feature', { var: UPLOAD_NS }),
            xml('x', { xmlns: DATAFORM_NS }, xml('field', { var: 'max-file-size' }, xml('value', {}, '4'))),
          ));
        return xml('iq', { type: 'result' }, xml('slot', { xmlns: UPLOAD_NS },
          xml('put', { xmlns: UPLOAD_NS }, 'https://upload.example.test/put', xml('header', { name: 'Authorization' }, 'Bearer test')),
          xml('get', { xmlns: UPLOAD_NS }, 'https://cdn.example.test/sticker.png'),
        ));
      },
    },
    send: async (stanza) => sent.push(stanza),
  };
  const adapter = {
    session,
    requests,
    sent,
    sessionGenerations: new Map([['alice@example.test', 1]]),
    sessionDomains: new Map([['alice@example.test', 'example.test']]),
    requireConnected: () => session,
    assertSessionCurrent: () => undefined,
    withTimeout: async (promise) => promise,
    bareJid: (value) => String(value).split('/')[0],
  };
  return adapter;
}

test('E8.5-XMPP-003 discovers HTTP Upload, validates the slot and sends one message', async () => {
  const adapter = mockAdapter();
  let putBody;
  const service = createXmppStickerService(adapter, {
    lookup: async () => [{ address: '203.0.113.10' }],
    readFile: async () => Buffer.from('data'),
    put: async (_url, body, headers) => { putBody = { body, headers }; return 201; },
  });
  const input = { version: 1, requestId: 'r1', accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'm1', stickerId: 's1' };
  const capability = await service.discover(input);
  assert.equal(capability.serviceJid, 'example.test');
  assert.equal(capability.maxFileSize, 4);
  const result = await service.send(input, async () => ({ ...sticker(), path: 'private', assetId: 'a1' }));
  assert.equal(result.transportStatus, 'sent');
  assert.equal(putBody.body.toString(), 'data');
  assert.equal(putBody.headers.Authorization, 'Bearer test');
  assert.equal(adapter.sent.length, 1);
});
