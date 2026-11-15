const test = require('node:test');
const assert = require('node:assert/strict');
const { xml } = require('@xmpp/client');
const {
  MAX_PROFILE_REQUESTS_PER_ACCOUNT,
  createXmppUserProfileService,
} = require('../electron/xmpp/xmpp-user-profile.cjs');
const { XmppProfileCache } = require('../electron/xmpp/xmpp-profile-cache.cjs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const ACCOUNT = 'operator@example.invalid';
const CONTACT = 'contact@example.invalid';
const IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function adapter(session, generation = 1) {
  return {
    sessions: new Map([[ACCOUNT, session]]),
    states: new Map([[ACCOUNT, { status: 'connected' }]]),
    sessionGenerations: new Map([[ACCOUNT, generation]]),
    requireConnected: () => session,
  };
}

function session(response) {
  const requests = [];
  return {
    requests,
    iqCaller: {
      request: async (stanza, timeoutMs) => {
        requests.push({ stanza, timeoutMs });
        return response;
      },
    },
  };
}

function card(children = []) {
  return xml('iq', {}, xml('vCard', { xmlns: 'vcard-temp' }, ...children));
}

const decoder = {
  createFromBuffer: () => ({
    isEmpty: () => false,
    getSize: () => ({ width: 1, height: 1 }),
  }),
};

test('XEP-0054 reads own and contact cards without mixing roster names', async () => {
  const own = session(card([xml('FN', {}, 'Own Name')]));
  const value = createXmppUserProfileService(adapter(own), { nativeImage: decoder });
  const ownProfile = await value.get(7, ACCOUNT, ACCOUNT);

  assert.equal(own.requests[0].stanza.attrs.to, undefined);
  assert.equal(ownProfile.displayName, 'Own Name');

  const contactSession = session(card([xml('FN', {}, 'Remote Name')]));
  const contactProfile = await createXmppUserProfileService(adapter(contactSession), {
    nativeImage: decoder,
  }).get(7, ACCOUNT, CONTACT);
  assert.equal(contactSession.requests[0].stanza.attrs.to, CONTACT);
  assert.equal(contactProfile.jid, CONTACT);
  assert.equal(contactProfile.source, 'vcard-temp');
});

test('updates only the own vCard text fields through IQ set', async () => {
  const current = session(
    card([
      xml('FN', {}, 'Old Name'),
      xml('N', {}, xml('GIVEN', {}, 'Old'), xml('MIDDLE', {}, 'Middle'), xml('FAMILY', {}, 'Name')),
      xml('EMAIL', {}, xml('USERID', {}, 'old@example.invalid')),
      xml('ORG', {}, xml('ORGNAME', {}, 'Old Company')),
      xml('TITLE', {}, 'Old Title'),
      xml(
        'ADR',
        {},
        xml('HOME', {}),
        xml('STREET', {}, 'Old Street'),
        xml('LOCALITY', {}, 'Old City'),
      ),
      xml('ADR', {}, xml('WORK', {}), xml('STREET', {}, 'Work Street')),
      xml('TEL', {}, xml('HOME', {}), xml('VOICE', {}), xml('NUMBER', {}, '000')),
      xml('TEL', {}, xml('HOME', {}), xml('CELL', {}), xml('NUMBER', {}, '001')),
      xml('TEL', {}, xml('HOME', {}), xml('FAX', {}), xml('NUMBER', {}, '002')),
      xml('TEL', {}, xml('HOME', {}), xml('PAGER', {}), xml('NUMBER', {}, '003')),
      xml('TEL', {}, xml('WORK', {}), xml('VOICE', {}), xml('NUMBER', {}, '004')),
      xml('BDAY', {}, '1985-01-02'),
      xml('DESC', {}, 'Old description'),
      xml('URL', {}, 'https://old.example.invalid'),
      xml('PHOTO', {}, xml('TYPE', {}, 'image/png'), xml('BINVAL', {}, IMAGE_BASE64)),
    ]),
  );
  const service = createXmppUserProfileService(adapter(current), { nativeImage: decoder });

  const profile = await service.update(7, ACCOUNT, {
    displayName: 'New Name',
    middleName: 'Second',
    company: 'Atomic Chat',
    jobTitle: 'Product Engineer',
    homeAddress: 'Atomic Street 42',
    homeCity: 'Quito',
    homeState: 'Pichincha',
    homePostalCode: '170101',
    homeCountry: 'Ecuador',
    phone: '+593 2 000 0000',
    mobile: '+593 99 000 0000',
    fax: '+593 2 000 0001',
    pager: 'atomic-42',
    birthday: '1990-11-15',
    description: 'Perfil de Atomic Chat',
    website: 'https://atomic.example.invalid/profile',
    nickname: 'Newbie',
    email: null,
  });

  assert.equal(current.requests.length, 2);
  assert.equal(current.requests[0].stanza.attrs.type, 'get');
  assert.equal(current.requests[0].stanza.attrs.to, undefined);
  assert.equal(current.requests[1].stanza.attrs.type, 'set');
  const published = current.requests[1].stanza.getChild('vCard', 'vcard-temp');
  assert.equal(published.getChildText('FN'), 'New Name');
  assert.equal(published.getChild('N').getChildText('MIDDLE'), 'Second');
  assert.equal(published.getChild('ORG').getChildText('ORGNAME'), 'Atomic Chat');
  assert.equal(published.getChildText('TITLE'), 'Product Engineer');
  const address = published.getChildren('ADR').find((item) => item.getChild('HOME'));
  assert.equal(address.getChildText('STREET'), 'Atomic Street 42');
  assert.equal(address.getChildText('LOCALITY'), 'Quito');
  assert.equal(address.getChildText('REGION'), 'Pichincha');
  assert.equal(address.getChildText('PCODE'), '170101');
  assert.equal(address.getChildText('CTRY'), 'Ecuador');
  const homePhones = published.getChildren('TEL').filter((item) => item.getChild('HOME'));
  assert.equal(homePhones[0].getChildText('NUMBER'), '+593 2 000 0000');
  assert.equal(homePhones[1].getChildText('NUMBER'), '+593 99 000 0000');
  assert.equal(homePhones[2].getChildText('NUMBER'), '+593 2 000 0001');
  assert.equal(homePhones[3].getChildText('NUMBER'), 'atomic-42');
  assert.equal(
    published
      .getChildren('ADR')
      .find((item) => item.getChild('WORK'))
      .getChildText('STREET'),
    'Work Street',
  );
  assert.equal(
    published
      .getChildren('TEL')
      .find((item) => item.getChild('WORK'))
      .getChildText('NUMBER'),
    '004',
  );
  assert.equal(published.getChildText('BDAY'), '1990-11-15');
  assert.equal(published.getChildText('DESC'), 'Perfil de Atomic Chat');
  assert.equal(published.getChildText('URL'), 'https://atomic.example.invalid/profile');
  assert.equal(published.getChildText('NICKNAME'), 'Newbie');
  assert.equal(published.getChild('EMAIL'), undefined);
  assert.equal(published.getChild('PHOTO')?.getChildText('TYPE'), 'image/png');
  assert.equal(profile.displayName, 'New Name');
  assert.equal(profile.middleName, 'Second');
  assert.equal(profile.company, 'Atomic Chat');
  assert.equal(profile.jobTitle, 'Product Engineer');
  assert.equal(profile.homeAddress, 'Atomic Street 42');
  assert.equal(profile.homeCity, 'Quito');
  assert.equal(profile.homeState, 'Pichincha');
  assert.equal(profile.homePostalCode, '170101');
  assert.equal(profile.homeCountry, 'Ecuador');
  assert.equal(profile.phone, '+593 2 000 0000');
  assert.equal(profile.mobile, '+593 99 000 0000');
  assert.equal(profile.fax, '+593 2 000 0001');
  assert.equal(profile.pager, 'atomic-42');
  assert.equal(profile.birthday, '1990-11-15');
  assert.equal(profile.description, 'Perfil de Atomic Chat');
  assert.equal(profile.website, 'https://atomic.example.invalid/profile');
  assert.equal(profile.email, undefined);
});

test('validates account and bare JID boundaries before sending IQ', async () => {
  const current = session(card());
  const service = createXmppUserProfileService(adapter(current), { nativeImage: decoder });
  await assert.rejects(service.get(7, 'legacy-account', CONTACT), { code: 'INVALID_JID' });
  await assert.rejects(service.get(7, ACCOUNT, 'room@example.invalid/resource'), {
    code: 'INVALID_JID',
  });
  assert.equal(current.requests.length, 0);
});

test('validates birthday and website values before publishing', async () => {
  const current = session(card());
  const service = createXmppUserProfileService(adapter(current), { nativeImage: decoder });
  await assert.rejects(service.update(7, ACCOUNT, { birthday: '15/11/1990' }), {
    code: 'INVALID_INPUT',
  });
  await assert.rejects(service.update(7, ACCOUNT, { website: 'javascript:alert(1)' }), {
    code: 'INVALID_INPUT',
  });
  assert.equal(current.requests.length, 0);
});

test('classifies an unsupported remote vCard as profile unavailable', async () => {
  const current = {
    iqCaller: {
      request: async () => {
        throw Object.assign(new Error('service unavailable'), {
          condition: 'service-unavailable',
        });
      },
    },
  };
  const service = createXmppUserProfileService(adapter(current), { nativeImage: decoder });

  await assert.rejects(service.get(7, ACCOUNT, CONTACT), { code: 'PROFILE_UNAVAILABLE' });
});

test('rejects a response from a replaced XMPP session as stale', async () => {
  let release;
  const current = {
    iqCaller: { request: () => new Promise((resolve) => (release = resolve)) },
  };
  const state = adapter(current);
  const service = createXmppUserProfileService(state, { nativeImage: decoder });
  const pending = service.get(7, ACCOUNT, CONTACT);
  state.sessions.set(ACCOUNT, {});
  release(card([xml('FN', {}, 'Late')]));
  await assert.rejects(pending, { code: 'STALE_RESPONSE' });
});

test('bounds concurrent profile requests per account', async () => {
  const releases = [];
  const current = {
    iqCaller: {
      request: () =>
        new Promise((resolve) => {
          releases.push(resolve);
        }),
    },
  };
  const service = createXmppUserProfileService(adapter(current), { nativeImage: decoder });
  const pending = Array.from({ length: MAX_PROFILE_REQUESTS_PER_ACCOUNT }, (_, index) =>
    service.get(7, ACCOUNT, `contact-${index}@example.invalid`),
  );
  await assert.rejects(service.get(7, ACCOUNT, 'overflow@example.invalid'), {
    code: 'RESOURCE_CONSTRAINT',
  });
  releases.forEach((resolve) => resolve(card([xml('FN', {}, 'Contact')])));
  await Promise.all(pending);
});

test('returns only an opaque image reference and streams validated bytes by grant', async () => {
  const current = session(
    card([xml('PHOTO', {}, xml('TYPE', {}, 'image/png'), xml('BINVAL', {}, IMAGE_BASE64))]),
  );
  const service = createXmppUserProfileService(adapter(current), { nativeImage: decoder });
  const profile = await service.get(7, ACCOUNT, CONTACT);

  assert.ok(profile.image);
  assert.equal(Object.hasOwn(profile, 'base64'), false);
  assert.equal(Object.hasOwn(profile.image, 'data'), false);
  const stream = service.openImage(7, {
    accountId: ACCOUNT,
    referenceId: profile.image.referenceId,
  });
  const chunk = service.readImage(7, {
    accountId: ACCOUNT,
    referenceId: profile.image.referenceId,
    streamId: stream.streamId,
    sequence: 0,
  });
  assert.equal(chunk.done, true);
  assert.deepEqual(Buffer.from(chunk.bytes), Buffer.from(IMAGE_BASE64, 'base64'));
  assert.throws(
    () => service.openImage(8, { accountId: ACCOUNT, referenceId: profile.image.referenceId }),
    { code: 'UNAUTHORIZED' },
  );
});

test('uses validated photo bytes when Openfire declares an equivalent or stale MIME type', async () => {
  const current = session(
    card([xml('PHOTO', {}, xml('TYPE', {}, 'image/jpeg'), xml('BINVAL', {}, IMAGE_BASE64))]),
  );
  const service = createXmppUserProfileService(adapter(current), { nativeImage: decoder });
  const profile = await service.get(7, ACCOUNT, CONTACT);

  assert.equal(profile.image?.mimeType, 'image/png');
  assert.equal(profile.avatarHash?.length, 40);
});

test('publishes and clears the XEP-0054 photo while preserving text fields', async () => {
  const current = session(
    card([xml('FN', {}, 'Existing name'), xml('ORG', {}, xml('ORGNAME', {}, 'Atomic Chat'))]),
  );
  const image = Buffer.from(IMAGE_BASE64, 'base64');
  const service = createXmppUserProfileService(adapter(current), {
    nativeImage: decoder,
    stat: async () => ({ size: image.length, isFile: () => true }),
    readFile: async () => image,
  });

  const publishedProfile = await service.updateAvatar(7, ACCOUNT, 'C:\\avatar.png');
  const published = current.requests[1].stanza.getChild('vCard', 'vcard-temp');
  assert.equal(published.getChildText('FN'), 'Existing name');
  assert.equal(published.getChild('ORG').getChildText('ORGNAME'), 'Atomic Chat');
  assert.equal(published.getChild('PHOTO').getChildText('TYPE'), 'image/png');
  assert.equal(published.getChild('PHOTO').getChildText('BINVAL'), IMAGE_BASE64);
  assert.ok(publishedProfile.image);

  await service.clearAvatar(7, ACCOUNT);
  const cleared = current.requests[3].stanza.getChild('vCard', 'vcard-temp');
  assert.equal(cleared.getChildText('FN'), 'Existing name');
  assert.equal(cleared.getChild('ORG').getChildText('ORGNAME'), 'Atomic Chat');
  assert.equal(cleared.getChild('PHOTO'), undefined);
});

test('rejects avatar files above the profile limit before XMPP publication', async () => {
  const current = session(card());
  const service = createXmppUserProfileService(adapter(current), {
    nativeImage: decoder,
    stat: async () => ({ size: 512 * 1024 + 1, isFile: () => true }),
    readFile: async () => Buffer.alloc(512 * 1024 + 1),
  });

  await assert.rejects(service.updateAvatar(7, ACCOUNT, 'C:\\large.png'), {
    code: 'MEDIA_SIZE_EXCEEDED',
  });
  assert.equal(current.requests.length, 0);
});

test('reuses the local profile cache and rejects a response made obsolete by XEP-0153', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'atomic-profile-service-'));
  try {
    const first = session(card([xml('FN', {}, 'Cached contact')]));
    const profileCache = new XmppProfileCache(directory, { nativeImage: decoder });
    const service = createXmppUserProfileService(adapter(first), {
      nativeImage: decoder,
      profileCache,
    });
    await service.get(7, ACCOUNT, CONTACT);
    await service.get(7, ACCOUNT, CONTACT);
    assert.equal(first.requests.length, 1);

    let release;
    const delayed = {
      iqCaller: { request: () => new Promise((resolve) => (release = resolve)) },
    };
    const state = adapter(delayed);
    const staleService = createXmppUserProfileService(state, {
      nativeImage: decoder,
    });
    const pending = staleService.get(7, ACCOUNT, CONTACT);
    await new Promise((resolve) => setImmediate(resolve));
    await staleService.handleAvatarHashChanged(ACCOUNT, CONTACT, 'b'.repeat(40));
    release(card([xml('FN', {}, 'Late contact')]));
    await assert.rejects(pending, { code: 'STALE_RESPONSE' });
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('stored profile mode rehydrates without sending another vCard IQ', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'atomic-profile-stored-'));
  try {
    const current = session(card([xml('FN', {}, 'Stored contact')]));
    const profileStore = new XmppProfileCache(directory, { nativeImage: decoder });
    const service = createXmppUserProfileService(adapter(current), {
      nativeImage: decoder,
      profileStore,
    });
    await service.get(7, ACCOUNT, CONTACT);
    const stored = await service.get(7, ACCOUNT, CONTACT, 'stored');
    assert.equal(stored.displayName, 'Stored contact');
    assert.equal(current.requests.length, 1);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});
