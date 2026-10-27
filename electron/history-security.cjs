const crypto = require('node:crypto');

function createHistorySecurity(configuredAccount, cursorKey = crypto.randomBytes(32)) {
  const owners = new Map();
  const pending = new Map(); let sequence = 0;
  const authorize = (senderId, accountId) => {
    const owner = owners.get(senderId);
    if (owner) return owner === accountId;
    if (configuredAccount && configuredAccount === accountId) { owners.set(senderId, accountId); return true; }
    return false;
  };
  return {
    authorize,
    beginConnection: (senderId, requestId) => { const token = `${requestId}:${++sequence}`; pending.set(senderId, token); return token; },
    completeConnection: (senderId, token, accountId) => { if (pending.get(senderId) === token) owners.set(senderId, accountId); },
    destroySender: (senderId) => { owners.delete(senderId); pending.delete(senderId); },
    encodeCursor: (value) => { const payload = Buffer.from(JSON.stringify(value)).toString('base64url'); const mac = crypto.createHmac('sha256', cursorKey).update(payload).digest('base64url'); return `${payload}.${mac}`; },
    decodeCursor: (cursor, accountId, conversationId) => { if (typeof cursor !== 'string' || cursor.length > 1024) throw new Error('INVALID_INPUT'); const [payload, mac] = cursor.split('.'); const expected = crypto.createHmac('sha256', cursorKey).update(payload || '').digest('base64url'); if (!payload || !mac || mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw new Error('INVALID_INPUT'); let value; try { value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new Error('INVALID_INPUT'); } if (value.accountId !== accountId || value.conversationId !== conversationId || !value.lower || !value.upper || typeof value.lower.createdAt !== 'string' || typeof value.lower.id !== 'string' || typeof value.upper.createdAt !== 'string' || typeof value.upper.id !== 'string') throw new Error('INVALID_INPUT'); return value; },
  };
}

module.exports = { createHistorySecurity };
