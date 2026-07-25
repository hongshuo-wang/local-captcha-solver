import { createModelStatusController, createPopupController, type PopupControllerAdapter, type PopupView, type PopupViewState } from '../../src/popup/controller';
import type { ModelStatusSnapshot } from '../../src/background/model-status';

export function createPopupView(root: HTMLElement): PopupView & { checkbox: HTMLInputElement; modelRetry: HTMLButtonElement; renderModelStatus(snapshot: ModelStatusSnapshot): void } {
  root.innerHTML = `
    <header class="popup-header"><span class="product-name">Local CAPTCHA Solver</span></header>
    <section class="model-panel" aria-label="本地识别模型状态">
      <div class="model-status-row">
        <p class="model-label">本地识别模型</p>
        <p class="model-status" role="status" aria-live="polite" data-model-status></p>
        <button type="button" class="model-retry" data-model-retry hidden>重试</button>
      </div>
      <progress class="model-progress" data-model-progress role="progressbar" aria-label="模型加载进度" aria-valuemin="0" aria-valuemax="100" value="0" max="100"></progress>
      <ul class="model-logs" data-model-logs aria-label="最近执行记录"></ul>
    </section>
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
  const modelStatus = root.querySelector<HTMLElement>('[data-model-status]');
  const modelProgress = root.querySelector<HTMLProgressElement>('[data-model-progress]');
  const modelRetry = root.querySelector<HTMLButtonElement>('[data-model-retry]');
  const modelLogs = root.querySelector<HTMLElement>('[data-model-logs]');
  if (hostname === null || checkbox === null || status === null || modelStatus === null || modelProgress === null || modelRetry === null || modelLogs === null) throw new Error('Popup view could not be initialized');

  return {
    checkbox,
    modelRetry,
    render(state: PopupViewState): void {
      hostname.textContent = state.hostname;
      checkbox.checked = state.checked;
      checkbox.disabled = state.disabled;
      status.textContent = state.error ?? state.status;
      status.classList.toggle('error', state.error !== undefined);
    },
    renderModelStatus(snapshot: ModelStatusSnapshot): void {
      modelStatus.textContent = snapshot.message;
      modelStatus.classList.toggle('ready', snapshot.status === 'ready');
      modelStatus.classList.toggle('loading', snapshot.status === 'loading');
      modelStatus.classList.toggle('error', snapshot.status === 'error');
      modelProgress.value = snapshot.progress;
      modelProgress.setAttribute('aria-valuenow', String(snapshot.progress));
      modelProgress.classList.toggle('ready', snapshot.status === 'ready');
      modelProgress.classList.toggle('error', snapshot.status === 'error');
      modelRetry.hidden = snapshot.status !== 'error';
      modelRetry.disabled = snapshot.status === 'loading';
      modelLogs.replaceChildren();
      if (snapshot.logs.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'model-log-empty';
        empty.textContent = '暂无执行记录';
        modelLogs.append(empty);
        return;
      }
      for (const log of snapshot.logs.slice(-30).reverse()) {
        const item = document.createElement('li');
        item.className = `model-log model-log-${log.outcome}`;
        item.textContent = log.durationMs === undefined ? log.message : `${log.message}（${Math.round(log.durationMs)} ms）`;
        modelLogs.append(item);
      }
    },
  };
}

export function startPopup(root: HTMLElement, adapter: PopupControllerAdapter): void {
  const view = createPopupView(root);
  const controller = createPopupController(adapter, view);
  const modelController = createModelStatusController(adapter, view);
  view.checkbox.addEventListener('change', () => { void controller.setEnabled(view.checkbox.checked); });
  view.modelRetry.addEventListener('click', () => { void modelController.retry(); });
  void controller.start();
  void modelController.start();
}

const root = document.querySelector<HTMLElement>('#app');
if (root !== null && typeof browser !== 'undefined') startPopup(root, { tabs: browser.tabs, runtime: browser.runtime, permissions: browser.permissions });
