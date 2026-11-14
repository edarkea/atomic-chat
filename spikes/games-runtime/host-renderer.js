(() => {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || 'iframe';
  const token = params.get('token') || '';
  const iframe = document.querySelector('#game');
  const status = document.querySelector('#status');

  localStorage.setItem('spike-host-only', 'host-value');

  const allowedKinds = new Set([
    'game-ready',
    'game-valid-message',
    'game-malformed-message',
    'network-result',
    'popup-result',
    'permission-result',
    'download-result',
  ]);
  const notify = (message) => window.spikeHost?.notify(message);

  notify({
    kind: 'host-ready',
    token,
    mode,
    hostAtomicChatVisible: typeof window.atomicChat !== 'undefined',
  });

  if (mode !== 'iframe') {
    iframe.remove();
    return;
  }

  iframe.src = `${params.get('gameUrl')}?mode=iframe&token=${encodeURIComponent(token)}`;
  window.addEventListener('message', (event) => {
    if (event.source !== iframe.contentWindow) return;
    const message = event.data;
    if (message?.kind === 'host-ack') return;
    if (!message || typeof message !== 'object' || message.token !== token) {
      notify({ kind: 'game-rejected', reason: 'invalid-token-or-shape' });
      return;
    }
    if (!allowedKinds.has(message.kind)) {
      notify(message);
      return;
    }
    notify({ ...message, source: 'iframe-child' });
    if (message.kind === 'game-ready') {
      status.textContent = 'game-ready';
      iframe.contentWindow.postMessage({ kind: 'host-ack', token }, '*');
    }
  });
})();

