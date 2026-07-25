import { createPopupController, type PopupControllerAdapter, type PopupView, type PopupViewState } from '../../src/popup/controller';

export function createPopupView(root: HTMLElement): PopupView & { checkbox: HTMLInputElement } {
  root.innerHTML = `
    <header class="popup-header"><span class="product-name">Local CAPTCHA Solver</span></header>
    <section class="site-panel" aria-label="Current site">
      <p class="site-label">Current site</p>
      <p class="hostname" data-popup-hostname></p>
      <div class="toggle-row">
        <label for="site-enabled">Automatically recognize on this site</label>
        <input id="site-enabled" class="site-toggle" type="checkbox" aria-describedby="site-status" />
      </div>
      <p id="site-status" class="status" role="status" aria-live="polite" data-popup-status></p>
    </section>`;

  const hostname = root.querySelector<HTMLElement>('[data-popup-hostname]');
  const checkbox = root.querySelector<HTMLInputElement>('#site-enabled');
  const status = root.querySelector<HTMLElement>('[data-popup-status]');
  if (hostname === null || checkbox === null || status === null) throw new Error('Popup view could not be initialized');

  return {
    checkbox,
    render(state: PopupViewState): void {
      hostname.textContent = state.hostname;
      checkbox.checked = state.checked;
      checkbox.disabled = state.disabled;
      status.textContent = state.error ?? state.status;
      status.classList.toggle('error', state.error !== undefined);
    },
  };
}

export function startPopup(root: HTMLElement, adapter: PopupControllerAdapter): void {
  const view = createPopupView(root);
  const controller = createPopupController(adapter, view);
  view.checkbox.addEventListener('change', () => { void controller.setEnabled(view.checkbox.checked); });
  void controller.start();
}

const root = document.querySelector<HTMLElement>('#app');
if (root !== null && typeof browser !== 'undefined') startPopup(root, { tabs: browser.tabs, runtime: browser.runtime, permissions: browser.permissions });
