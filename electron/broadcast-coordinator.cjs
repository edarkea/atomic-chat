const crypto = require('node:crypto');

const MAX_CONCURRENT_SENDS = 3;

function bareJid(value) {
  return String(value || '')
    .trim()
    .split('/')[0]
    .toLowerCase();
}

function uniqueRecipients(values) {
  return [...new Set(values.map(bareJid).filter(Boolean))];
}

function errorCode(error) {
  const raw = error?.code || error?.message;
  if (raw === 'not_connected') return 'NOT_CONNECTED';
  if (['INVALID_INPUT', 'UNAUTHORIZED', 'NOT_CONNECTED'].includes(raw)) return raw;
  return 'TRANSPORT_FAILED';
}

function createBroadcastCoordinator({ xmpp }) {
  async function send(input) {
    const senderJid = bareJid(input.accountId);
    const recipients = uniqueRecipients(input.recipientJids).filter(
      (recipientJid) => recipientJid !== senderJid,
    );
    if (!recipients.length) throw new Error('INVALID_INPUT');
    const results = recipients.map((recipientJid) => ({
      recipientJid,
      clientMessageId: `client-msg_${crypto.randomUUID()}`,
      status: 'queued',
    }));
    let nextIndex = 0;

    const worker = async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= results.length) return;
        const current = results[index];
        if (
          !xmpp.sessions.has(input.accountId) ||
          xmpp.states.get(input.accountId)?.status !== 'connected'
        ) {
          results[index] = { ...current, status: 'failed', errorCode: 'NOT_CONNECTED' };
          continue;
        }
        try {
          await xmpp.sendMessage(input.accountId, {
            version: 1,
            requestId: `${input.requestId}:${index + 1}`,
            to: current.recipientJid,
            clientMessageId: current.clientMessageId,
            broadcast: true,
            mode: input.mode || 'normal',
            body: input.body,
          });
          results[index] = { ...current, status: 'submitted' };
        } catch (error) {
          const code = errorCode(error);
          results[index] = {
            ...current,
            status: code === 'NOT_CONNECTED' ? 'failed' : 'unknown',
            errorCode: code,
          };
        }
      }
    };

    const workerCount = Math.min(MAX_CONCURRENT_SENDS, Math.max(recipients.length, 1));
    await Promise.all(Array.from({ length: workerCount }, worker));
    return { broadcastId: input.broadcastId, recipients: results };
  }

  return { send };
}

module.exports = { bareJid, createBroadcastCoordinator, uniqueRecipients };
