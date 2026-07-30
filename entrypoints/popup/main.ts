import { createAutoFillPreferenceController, createCopyPreferenceController, createModelStatusController, createPopupController, createShortcutPreferenceController, type PopupControllerAdapter, type PopupView, type PopupViewState } from '../../src/popup/controller';
import type { ModelStatusSnapshot } from '../../src/background/model-status';
import { sendRuntimeMessage } from '../../src/platform/runtime-messaging';
import { isRecognitionShortcut, type RecognitionShortcut } from '../../src/platform/settings-store';

export interface PopupViewElements extends PopupView {
  checkbox: HTMLInputElement;
  autoFillCheckbox: HTMLInputElement;
  copyCheckbox: HTMLInputElement;
  shortcutSelect: HTMLSelectElement;
  accessButton: HTMLButtonElement;
  modelRetry: HTMLButtonElement;
  renderModelStatus(snapshot: ModelStatusSnapshot): void;
  renderAutoFillPreference(enabled: boolean): void;
  renderCopyPreference(enabled: boolean): void;
  renderShortcutPreference(shortcut: RecognitionShortcut): void;
}

export function createPopupView(root: HTMLElement): PopupViewElements {
  root.innerHTML = `
    <header class="popup-header">
      <div class="brand-mark" aria-hidden="true">验</div>
      <div class="brand-copy"><h1>本地验证码识别器</h1><p data-model-summary>正在读取模型状态</p></div>
      <span class="model-indicator" data-model-indicator aria-hidden="true"></span>
    </header>

    <section class="access-panel" data-access-panel hidden aria-labelledby="access-title">
      <p class="section-kicker">首次启用</p>
      <h2 id="access-title">允许在网站中识别验证码</h2>
      <p>验证码图片仅在本机处理。</p>
      <button type="button" class="primary-command" data-access-button>启用全站访问</button>
    </section>

    <section class="site-panel" data-controls-panel aria-label="当前网站设置">
      <div class="site-heading">
        <div><p class="section-kicker">当前网站</p><h2 class="hostname" data-popup-hostname></h2></div>
        <label class="switch" aria-label="在此网站自动识别验证码">
          <input id="site-enabled" type="checkbox" aria-describedby="site-status" />
          <span aria-hidden="true"></span>
        </label>
      </div>
      <p id="site-status" class="status" role="status" aria-live="polite" data-popup-status></p>

      <div class="setting-list">
        <div class="setting-row">
          <div><label for="auto-fill">自动填充</label><p>仅填入高置信度结果</p></div>
          <label class="switch"><input id="auto-fill" type="checkbox" /><span aria-hidden="true"></span></label>
        </div>
        <div class="setting-row">
          <div><label for="copy-on-no-field">自动复制</label><p>找不到输入框时复制结果</p></div>
          <label class="switch"><input id="copy-on-no-field" type="checkbox" /><span aria-hidden="true"></span></label>
        </div>
      </div>
    </section>

    <section class="activity-panel" data-controls-panel aria-labelledby="activity-title">
      <div class="section-heading"><p class="section-kicker">最近状态</p><time data-latest-time></time></div>
      <p id="activity-title" class="latest-activity" data-latest-activity>暂无执行记录</p>
    </section>

    <details class="diagnostics" data-controls-panel>
      <summary>诊断信息</summary>
      <div class="diagnostics-body">
        <div class="model-status-row"><p data-model-status role="status" aria-live="polite"></p><button type="button" class="text-command" data-model-retry hidden>重新加载</button></div>
        <progress data-model-progress role="progressbar" aria-label="模型加载进度" aria-valuemin="0" aria-valuemax="100" value="0" max="100"></progress>
        <label class="shortcut-row" for="recognition-shortcut"><span>图片识别快捷操作</span>
          <select id="recognition-shortcut">
            <option value="middle">鼠标中键</option>
            <option value="ctrl-click">Ctrl/Command + 左键</option>
            <option value="alt-click">Alt + 左键</option>
            <option value="shift-click">Shift + 左键</option>
          </select>
        </label>
        <ul class="model-logs" data-model-logs aria-label="最近执行记录"></ul>
      </div>
    </details>`;

  const required = <T extends Element>(selector: string): T => {
    const element = root.querySelector<T>(selector);
    if (element === null) throw new Error(`Popup view is missing ${selector}`);
    return element;
  };
  const hostname = required<HTMLElement>('[data-popup-hostname]');
  const checkbox = required<HTMLInputElement>('#site-enabled');
  const autoFillCheckbox = required<HTMLInputElement>('#auto-fill');
  const copyCheckbox = required<HTMLInputElement>('#copy-on-no-field');
  const shortcutSelect = required<HTMLSelectElement>('#recognition-shortcut');
  const status = required<HTMLElement>('[data-popup-status]');
  const accessPanel = required<HTMLElement>('[data-access-panel]');
  const accessButton = required<HTMLButtonElement>('[data-access-button]');
  const controls = root.querySelectorAll<HTMLElement>('[data-controls-panel]');
  const modelSummary = required<HTMLElement>('[data-model-summary]');
  const modelIndicator = required<HTMLElement>('[data-model-indicator]');
  const modelStatus = required<HTMLElement>('[data-model-status]');
  const modelProgress = required<HTMLProgressElement>('[data-model-progress]');
  const modelRetry = required<HTMLButtonElement>('[data-model-retry]');
  const modelLogs = required<HTMLElement>('[data-model-logs]');
  const diagnostics = required<HTMLDetailsElement>('.diagnostics');
  const latestActivity = required<HTMLElement>('[data-latest-activity]');
  const latestTime = required<HTMLTimeElement>('[data-latest-time]');

  return {
    checkbox,
    autoFillCheckbox,
    copyCheckbox,
    shortcutSelect,
    accessButton,
    modelRetry,
    render(state: PopupViewState): void {
      hostname.textContent = state.hostname;
      checkbox.checked = state.checked;
      checkbox.disabled = state.disabled;
      accessPanel.hidden = state.accessGranted;
      controls.forEach((element) => { element.hidden = !state.accessGranted; });
      status.textContent = state.error ?? state.status;
      status.classList.toggle('error', state.error !== undefined);
      accessButton.disabled = state.status.includes('正在请求');
    },
    renderAutoFillPreference(enabled: boolean): void { autoFillCheckbox.checked = enabled; },
    renderCopyPreference(enabled: boolean): void { copyCheckbox.checked = enabled; },
    renderShortcutPreference(shortcut: RecognitionShortcut): void { shortcutSelect.value = shortcut; },
    renderModelStatus(snapshot: ModelStatusSnapshot): void {
      modelSummary.textContent = snapshot.status === 'ready' ? '模型已就绪' : snapshot.message;
      modelIndicator.dataset.state = snapshot.status;
      modelStatus.textContent = snapshot.message;
      modelStatus.className = `model-status ${snapshot.status}`;
      modelProgress.value = snapshot.progress;
      modelProgress.setAttribute('aria-valuenow', String(snapshot.progress));
      modelRetry.hidden = snapshot.status !== 'error';
      modelRetry.disabled = snapshot.status === 'loading';
      if (snapshot.status === 'error') diagnostics.open = true;

      const latest = [...snapshot.logs].reverse().find((log) => log.kind === 'workflow')
        ?? [...snapshot.logs].reverse().find((log) => log.kind === 'recognition' && log.outcome !== 'started');
      latestActivity.textContent = latest?.message ?? '暂无执行记录';
      latestTime.textContent = latest === undefined ? '' : new Date(latest.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      modelLogs.replaceChildren();
      const logs = snapshot.logs.slice(-10).reverse();
      if (logs.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'model-log-empty';
        empty.textContent = '暂无诊断记录';
        modelLogs.append(empty);
      } else {
        for (const log of logs) {
          const item = document.createElement('li');
          item.className = `model-log model-log-${log.outcome}`;
          const duration = log.durationMs === undefined ? '' : ` · ${Math.round(log.durationMs)} ms`;
          item.textContent = `${log.message}${duration}`;
          modelLogs.append(item);
        }
      }
    },
  };
}

export function startPopup(root: HTMLElement, adapter: PopupControllerAdapter): void {
  const view = createPopupView(root);
  const controller = createPopupController(adapter, view);
  const autoFillController = createAutoFillPreferenceController(adapter, view);
  const copyController = createCopyPreferenceController(adapter, view);
  const shortcutController = createShortcutPreferenceController(adapter, view);
  const modelController = createModelStatusController(adapter, view);
  view.accessButton.addEventListener('click', () => { void controller.grantAccess(); });
  view.checkbox.addEventListener('change', () => { void controller.setEnabled(view.checkbox.checked); });
  view.autoFillCheckbox.addEventListener('change', () => { void autoFillController.setEnabled(view.autoFillCheckbox.checked); });
  view.copyCheckbox.addEventListener('change', () => { void copyController.setEnabled(view.copyCheckbox.checked); });
  view.shortcutSelect.addEventListener('change', () => { if (isRecognitionShortcut(view.shortcutSelect.value)) void shortcutController.setShortcut(view.shortcutSelect.value); });
  view.modelRetry.addEventListener('click', () => { void modelController.retry(); });
  void controller.start();
  void autoFillController.start();
  void copyController.start();
  void shortcutController.start();
  void modelController.start();
}

const root = document.querySelector<HTMLElement>('#app');
if (root !== null && typeof browser !== 'undefined') startPopup(root, { tabs: browser.tabs, runtime: { sendMessage: (message) => sendRuntimeMessage(browser.runtime, message) }, permissions: browser.permissions });
