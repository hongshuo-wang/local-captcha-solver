import type { WorkflowResult } from '../core/types';

export type CopyOutcome = 'copied' | 'disabled' | 'failed';
export type StatusTone = 'running' | 'success' | 'warning' | 'error' | 'neutral';

export interface StatusAction {
  label: string;
  onClick: () => boolean | void | Promise<boolean | void>;
  kind?: 'primary' | 'secondary';
  successMessage?: string;
  failureMessage?: string;
}

export interface WorkflowStatusOptions {
  actions?: readonly StatusAction[];
  copyOutcome?: CopyOutcome;
  onDismiss?: () => void;
}

const ICONS: Record<StatusTone, string> = {
  running: '…',
  success: '✓',
  warning: '!',
  error: '×',
  neutral: 'i',
};

const MESSAGES: Record<WorkflowResult['state'], string> = {
  filled: '验证码已识别并填入',
  needs_confirmation: '结果不够确定',
  no_candidate: '没有找到可识别的验证码',
  no_field: '没有找到对应的验证码输入框',
  image_unavailable: '验证码图片无法读取',
  permission_denied: '浏览器未允许读取验证码图片',
  recognition_failed: '验证码识别失败',
  stale: '验证码已变化',
  model_unavailable: '本地识别模型不可用',
  ambiguous_image: '找到多个匹配的验证码图片',
};

let removalTimer: ReturnType<typeof setTimeout> | undefined;
let positionCleanup: (() => void) | undefined;

function clearCurrent(): void {
  if (removalTimer !== undefined) clearTimeout(removalTimer);
  removalTimer = undefined;
  positionCleanup?.();
  positionCleanup = undefined;
  document.querySelector('[data-local-captcha-status]')?.remove();
}

function position(host: HTMLElement, anchor?: Element): void {
  const width = Math.min(304, Math.max(240, globalThis.innerWidth - 24));
  const fallbackLeft = Math.max(12, globalThis.innerWidth - width - 12);
  const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : undefined;
  const left = rect === undefined ? fallbackLeft : Math.min(Math.max(12, rect.left), fallbackLeft);
  const estimatedHeight = Math.min(176, host.getBoundingClientRect().height || 112);
  const below = rect === undefined ? globalThis.innerHeight - estimatedHeight - 12 : rect.bottom + 10;
  const top = rect === undefined
    ? Math.max(12, below)
    : below + estimatedHeight <= globalThis.innerHeight - 12
      ? below
      : Math.max(12, rect.top - estimatedHeight - 10);
  Object.assign(host.style, { width: `${width}px`, left: `${left}px`, top: `${top}px` });
}

function show(
  message: string,
  anchor: Element | undefined,
  tone: StatusTone,
  actions: readonly StatusAction[] = [],
  options: { timeoutMs?: number; onDismiss?: () => void; detail?: string } = {},
): void {
  clearCurrent();
  const host = document.createElement('div');
  host.dataset.localCaptchaStatus = 'true';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483000';
  host.style.pointerEvents = 'none';
  if (anchor?.isConnected) host.dataset.anchor = 'candidate';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { color-scheme: light dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; letter-spacing: 0; }
      .panel { pointer-events: auto; display: grid; grid-template-columns: 28px minmax(0,1fr) auto; gap: 10px; align-items: start; padding: 12px; color: #202522; background: rgba(252,253,252,.98); border: 1px solid #d9dedb; border-radius: 8px; box-shadow: 0 12px 32px rgba(31,44,36,.16), 0 2px 8px rgba(31,44,36,.08); animation: enter .18s ease-out; }
      .icon { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 7px; color: #3f5f4b; background: #eaf0ec; font: 600 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .panel[data-tone="success"] .icon { color: #21623b; background: #e3f2e8; }
      .panel[data-tone="warning"] .icon { color: #765512; background: #f8edcf; }
      .panel[data-tone="error"] .icon { color: #922f2b; background: #f8e5e3; }
      .panel[data-tone="running"] .icon { animation: pulse 1s ease-in-out infinite; }
      .content { min-width: 0; padding-top: 3px; }
      .message, .detail { margin: 0; overflow-wrap: anywhere; letter-spacing: 0; }
      .message { color: inherit; font-size: 13px; font-weight: 600; line-height: 1.45; }
      .detail { margin-top: 3px; color: #646d67; font-size: 12px; line-height: 1.45; }
      .close { width: 28px; height: 28px; display: grid; place-items: center; margin: 0; padding: 0; border: 0; border-radius: 6px; color: #68716b; background: transparent; cursor: pointer; font: 18px/1 ui-sans-serif, sans-serif; transition: background .16s ease, color .16s ease, transform .16s ease; }
      .close:hover { color: #202522; background: #edf0ee; }
      .close:active { transform: translateY(1px); }
      .close:focus-visible, button.action:focus-visible { outline: 2px solid #47725a; outline-offset: 2px; }
      .actions { grid-column: 2 / 4; display: flex; flex-wrap: wrap; gap: 7px; margin-top: 1px; }
      button.action { min-height: 30px; padding: 5px 11px; border: 1px solid #cbd2cd; border-radius: 6px; color: #303732; background: #fff; cursor: pointer; font: 600 12px/1.3 inherit; letter-spacing: 0; transition: background .16s ease, border-color .16s ease, transform .16s ease; }
      button.action:hover { background: #f1f4f2; border-color: #aeb9b1; }
      button.action:active { transform: translateY(1px); }
      button.action.primary { color: #fff; background: #315c43; border-color: #315c43; }
      button.action.primary:hover { background: #254c35; border-color: #254c35; }
      button.action:disabled { opacity: .58; cursor: wait; }
      @keyframes enter { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes pulse { 50% { opacity: .5; } }
      @media (prefers-color-scheme: dark) {
        .panel { color: #edf1ee; background: rgba(31,35,32,.98); border-color: #4b514d; box-shadow: 0 14px 34px rgba(0,0,0,.34); }
        .icon { color: #c3d4c8; background: #3b4840; }
        .panel[data-tone="success"] .icon { color: #bde4c8; background: #284934; }
        .panel[data-tone="warning"] .icon { color: #ecd28e; background: #4f4224; }
        .panel[data-tone="error"] .icon { color: #f0b4af; background: #56312f; }
        .detail { color: #acb4af; }
        .close { color: #aeb6b1; }
        .close:hover { color: #fff; background: #404541; }
        button.action { color: #edf1ee; background: #343936; border-color: #565e58; }
        button.action:hover { background: #414843; border-color: #707b73; }
        button.action.primary { color: #fff; background: #47785a; border-color: #47785a; }
      }
      @media (prefers-reduced-motion: reduce) { .panel, .icon { animation: none !important; } }
    </style>
    <section class="panel" data-tone="${tone}" role="status" aria-live="polite">
      <span class="icon" aria-hidden="true">${ICONS[tone]}</span>
      <div class="content"><p class="message"></p><p class="detail" hidden></p></div>
      <button class="close" type="button" aria-label="关闭">×</button>
      <div class="actions"></div>
    </section>`;
  const messageElement = shadow.querySelector<HTMLElement>('.message')!;
  const detailElement = shadow.querySelector<HTMLElement>('.detail')!;
  const close = shadow.querySelector<HTMLButtonElement>('.close')!;
  const actionsElement = shadow.querySelector<HTMLElement>('.actions')!;
  messageElement.textContent = message;
  if (options.detail) {
    detailElement.hidden = false;
    detailElement.textContent = options.detail;
  }
  const dismiss = (): void => {
    clearCurrent();
    options.onDismiss?.();
  };
  close.addEventListener('click', dismiss);
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `action ${action.kind ?? 'secondary'}`;
    button.textContent = action.label;
    button.addEventListener('click', async () => {
      button.disabled = true;
      let succeeded = true;
      try { succeeded = await action.onClick() !== false; } catch { succeeded = false; }
      const nextMessage = succeeded ? action.successMessage : action.failureMessage;
      clearCurrent();
      if (nextMessage) show(nextMessage, anchor, succeeded ? 'success' : 'error', [], { timeoutMs: 1800 });
    });
    actionsElement.append(button);
  }
  if (actions.length === 0) actionsElement.remove();
  if (actions.length === 0 && options.onDismiss === undefined && (options.timeoutMs ?? 0) > 0) close.hidden = true;
  document.body.append(host);
  const updatePosition = () => position(host, anchor);
  updatePosition();
  requestAnimationFrame(updatePosition);
  globalThis.addEventListener('scroll', updatePosition, true);
  globalThis.addEventListener('resize', updatePosition);
  positionCleanup = () => {
    globalThis.removeEventListener('scroll', updatePosition, true);
    globalThis.removeEventListener('resize', updatePosition);
  };
  const timeoutMs = options.timeoutMs ?? (actions.length > 0 ? 0 : 4000);
  if (timeoutMs > 0) removalTimer = setTimeout(clearCurrent, timeoutMs);
}

export function showRecognizing(anchor?: Element, stage: 'preparing' | 'recognizing' = 'recognizing'): void {
  show(stage === 'preparing' ? '正在准备本地模型' : '正在识别验证码', anchor, 'running', [], { timeoutMs: 0 });
}

export function showWorkflowStatus(
  result: WorkflowResult,
  anchor?: Element,
  legacyConfirmOrOptions?: (() => void) | WorkflowStatusOptions,
  legacyCopyOutcome?: CopyOutcome,
): void {
  const options: WorkflowStatusOptions = typeof legacyConfirmOrOptions === 'function'
    ? { actions: [{ label: '填入', kind: 'primary', onClick: legacyConfirmOrOptions, successMessage: '已填入验证码' }], copyOutcome: legacyCopyOutcome }
    : { ...(legacyConfirmOrOptions ?? {}), copyOutcome: legacyConfirmOrOptions?.copyOutcome ?? legacyCopyOutcome };
  const value = 'displayText' in result ? result.displayText || result.fillValue : '';
  if (result.state === 'filled') {
    show('已自动填入验证码', anchor, 'success', [], { timeoutMs: 1800, detail: value });
    return;
  }
  if (result.state === 'needs_confirmation') {
    const detail = result.fillValue === undefined ? '未得到可安全使用的结果' : value;
    show(result.fillValue === undefined ? '无法可靠识别' : '结果不够确定', anchor, 'warning', options.actions, { detail, onDismiss: options.onDismiss });
    return;
  }
  if (result.state === 'no_field') {
    const copyDetail = options.copyOutcome === 'copied' ? '已复制到剪贴板' : options.copyOutcome === 'failed' ? '自动复制失败' : '未找到对应输入框';
    show(options.copyOutcome === 'copied' ? '识别完成并已复制' : '识别完成', anchor, options.copyOutcome === 'failed' ? 'error' : 'neutral', options.actions, { detail: `${value} · ${copyDetail}`, onDismiss: options.onDismiss });
    return;
  }
  const retryable = result.state === 'recognition_failed' || result.state === 'image_unavailable' || result.state === 'permission_denied' || result.state === 'model_unavailable';
  const tone: StatusTone = retryable ? 'error' : result.state === 'stale' ? 'warning' : 'neutral';
  show(MESSAGES[result.state], anchor, tone, options.actions, { timeoutMs: retryable ? 0 : 4000, onDismiss: options.onDismiss });
}

export function clearWorkflowStatus(): void { clearCurrent(); }
