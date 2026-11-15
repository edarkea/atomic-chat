(async () => {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || document.documentElement.dataset.spikeMode || 'view';
  const token = params.get('token') || document.documentElement.dataset.spikeToken || '';
  const checks = {
    atomicChatVisible: typeof window.atomicChat !== 'undefined',
    nodeRequireVisible: typeof window.require === 'function',
    nodeProcessVisible: typeof window.process !== 'undefined',
    explicitBridgeOnly: mode === 'iframe' || typeof window.spikeGame?.send === 'function',
  };

  let storageAvailable = false;
  try {
    localStorage.setItem('spike-game-only', 'game-value');
    storageAvailable = localStorage.getItem('spike-game-only') === 'game-value';
  } catch {
    storageAvailable = false;
  }

  const send = (message) => {
    const value = { ...message, token };
    if (mode === 'iframe') window.parent.postMessage(value, '*');
    else window.spikeGame?.send(value);
  };

  const ready = {
    kind: 'game-ready',
    checks: { ...checks, storageAvailable },
  };
  send(ready);

  // This must be rejected by the host/Main validation because the token is wrong.
  if (mode === 'iframe') {
    window.parent.postMessage({ kind: 'game-valid-message', token: 'wrong-token' }, '*');
  } else {
    window.spikeGame?.send({ kind: 'game-malformed-message', token: 'wrong-token' });
  }

  // A valid, bounded structured message proves the allowed direction.
  send({ kind: 'game-valid-message', payload: { value: 'inert', sequence: 1 } });

  // A valid token with an unknown kind must be rejected by the receiver schema.
  if (mode === 'iframe') {
    window.parent.postMessage({ kind: 'unsupported-kind', token }, '*');
  } else {
    window.spikeGame?.send({ kind: 'unsupported-kind', token });
  }

  // The session policy should reject this before a network connection is made.
  void fetch('https://atomic-chat-games-spike.invalid/blocked')
    .then(() => send({ kind: 'network-result', result: 'unexpected-success' }))
    .catch(() => send({ kind: 'network-result', result: 'blocked-or-failed' }));

  const popup = window.open('https://atomic-chat-games-spike.invalid/popup');
  send({ kind: 'popup-result', blocked: popup === null });

  const permissionResult = typeof Notification === 'undefined'
    ? 'unsupported'
    : await Promise.race([
        Notification.requestPermission().catch(() => 'error'),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 250)),
      ]);
  send({ kind: 'permission-result', result: permissionResult });

  const download = document.createElement('a');
  download.href = 'atomic-game://fixture/game.html';
  download.download = 'fixture.html';
  download.textContent = 'inert-download';
  document.body.append(download);
  download.click();
  download.remove();
  send({ kind: 'download-result', result: 'requested' });
})();

