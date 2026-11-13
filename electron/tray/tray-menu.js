const api = window.trayMenu;
function render(state) {
  const light = state.theme === 'atomic-light' || state.theme === 'light';
  const defaults = light
    ? {
        background: '#F2F8F1',
        text: '#14301D',
        accent: '#186A38',
        border: '#6C9273',
        surfaceRaised: '#DCECDD',
        focus: '#155E31',
      }
    : {
        background: '#020d07',
        text: '#d7f5dc',
        accent: '#5ced79',
        border: '#287744',
        surfaceRaised: '#092818',
        focus: '#8dffa0',
      };
  for (const [key, fallback] of Object.entries(defaults)) {
    const custom = state.theme === 'custom' ? state.customTheme?.[key] : undefined;
    document.documentElement.style.setProperty(
      `--${key}`,
      /^#[0-9a-f]{6}$/i.test(custom || '') ? custom : fallback,
    );
  }
}
api.subscribe(render);
api
  .getState()
  .then(render)
  .catch(() => {
    // The tray remains usable even if its initial state arrives late.
  });
document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    await api.action(button.dataset.action);
  } catch {
    // Closing the popup is the safe fallback for a failed tray action.
  } finally {
    button.disabled = false;
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') void api.action('hide').catch(() => undefined);
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  const buttons = [...document.querySelectorAll('button')].filter(
    (button) => !button.matches(':disabled'),
  );
  const index = buttons.indexOf(document.activeElement);
  event.preventDefault();
  buttons[
    (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
  ]?.focus();
});
window.addEventListener('focus', () => document.querySelector('button')?.focus());
