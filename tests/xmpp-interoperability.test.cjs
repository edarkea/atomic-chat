const test = require('node:test');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');

const required = ['ATOMIC_XMPP_SERVICE', 'ATOMIC_XMPP_DOMAIN', 'ATOMIC_XMPP_USERNAME', 'ATOMIC_XMPP_PASSWORD'];
const configured = required.every((name) => process.env[name] && !process.env[name].startsWith('replace-with-'));

test('XMPP interoperability VAL-P0-001/003/005', { skip: !configured }, async () => {
  const adapter = new XmppAdapter();
  const allowInsecureTls = process.env.ATOMIC_XMPP_ALLOW_INSECURE_TLS === 'true';
  if (allowInsecureTls) console.warn('WARNING: XMPP validation uses insecure TLS exceptions; result is not production-valid.');
  if (allowInsecureTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const input = { accountId: `${process.env.ATOMIC_XMPP_USERNAME}@${process.env.ATOMIC_XMPP_DOMAIN}`, endpoint: { host: process.env.ATOMIC_XMPP_SERVICE, port: Number(process.env.ATOMIC_XMPP_PORT || 5222), tls: true, allowInsecureTls } };
  const state = await adapter.connect(input, process.env.ATOMIC_XMPP_PASSWORD);
  if (state.status !== 'connected') throw new Error('XMPP connection did not reach connected state');
  await adapter.setPresence(input.accountId, { availability: 'available' });
  const message = await adapter.sendMessage(input.accountId, { to: input.accountId, body: { kind: 'text', text: 'Atomic Chat P0 interoperability check' }, clientMessageId: `interop_${Date.now()}` });
  if (message.status !== 'sent') throw new Error('XMPP message was not accepted by the adapter');
  await adapter.disconnect(input.accountId);
});
