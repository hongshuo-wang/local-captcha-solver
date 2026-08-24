import type { WorkflowResult } from '../core/types';
import type { UiLocale } from '../platform/i18n';
import { visibleSliderInteractionTarget } from '../slider/challenge-discovery';
import type { SliderResultState, SliderRunResult } from '../slider/types';

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

const ZH_MESSAGES: Record<WorkflowResult['state'], string> = {
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

const EN_MESSAGES: Record<WorkflowResult['state'], string> = {
  filled: 'CAPTCHA recognized and filled', needs_confirmation: 'The result needs confirmation', no_candidate: 'No recognizable CAPTCHA was found',
  no_field: 'No matching CAPTCHA input was found', image_unavailable: 'The CAPTCHA image could not be read', permission_denied: 'The browser did not allow image access',
  recognition_failed: 'CAPTCHA recognition failed', stale: 'The CAPTCHA changed', model_unavailable: 'The local recognition model is unavailable', ambiguous_image: 'Multiple matching CAPTCHA images were found',
};

const CONFIRMATION_MESSAGES = {
  low_confidence: '识别结果需要确认',
  auto_fill_disabled: '自动填充已关闭',
  ambiguous_field: '请选择要填入的输入框',
  field_not_empty: '输入框已有内容',
  unusable_result: '无法可靠识别',
} as const;

const EN_CONFIRMATION_MESSAGES: Record<keyof typeof CONFIRMATION_MESSAGES, string> = {
  low_confidence: 'The recognition result needs confirmation', auto_fill_disabled: 'Automatic fill is disabled', ambiguous_field: 'Choose the input field',
  field_not_empty: 'The input field already has a value', unusable_result: 'No reliable result was produced',
};

let statusLocale: UiLocale = 'zh_CN';
const localized = (zh: string, en: string): string => statusLocale === 'zh_CN' ? zh : en;

export function setStatusUiLocale(locale: UiLocale): void { statusLocale = locale; }

let removalTimer: ReturnType<typeof setTimeout> | undefined;
let positionCleanup: (() => void) | undefined;
let sliderHighlightCleanup: (() => void) | undefined;
let currentStatusKind: 'workflow' | 'slider' | 'slider-user-active' | undefined;
type StatusPresentation = 'toast' | 'panel';

function clearCurrent(): void {
  if (removalTimer !== undefined) clearTimeout(removalTimer);
  removalTimer = undefined;
  positionCleanup?.();
  positionCleanup = undefined;
  sliderHighlightCleanup?.();
  sliderHighlightCleanup = undefined;
  currentStatusKind = undefined;
  document.querySelector('[data-local-captcha-status]')?.remove();
}

function visibleSliderTarget(): Element | undefined {
  return visibleSliderInteractionTarget(document);
}

function highlightSlider(): Element | undefined {
  sliderHighlightCleanup?.();
  sliderHighlightCleanup = undefined;
  const target = visibleSliderTarget();
  if (target === undefined) return undefined;
  const host = document.createElement('div');
  host.dataset.localCaptchaSliderHighlight = 'true';
  host.setAttribute('aria-hidden', 'true');
  Object.assign(host.style, { position: 'fixed', zIndex: '2147482999', pointerEvents: 'none', overflow: 'visible' });
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { display: block; }
      .ring { width: 100%; height: 100%; box-sizing: border-box; border: 3px solid #f08c00; border-radius: 8px; box-shadow: 0 0 0 4px rgba(240,140,0,.26), 0 0 22px rgba(240,140,0,.46); animation: pulse 1.15s ease-in-out infinite; }
      @keyframes pulse { 50% { opacity: .58; box-shadow: 0 0 0 7px rgba(240,140,0,.16), 0 0 30px rgba(240,140,0,.32); } }
      @media (prefers-reduced-motion: reduce) { .ring { animation: none; } }
    </style>
    <div class="ring"></div>`;
  document.body.append(host);
  const update = () => {
    if (!target.isConnected || target.getClientRects().length === 0) return;
    const rect = target.getBoundingClientRect();
    Object.assign(host.style, { left: `${Math.max(0, rect.left - 4)}px`, top: `${Math.max(0, rect.top - 4)}px`, width: `${rect.width + 8}px`, height: `${rect.height + 8}px` });
  };
  update();
  requestAnimationFrame(update);
  globalThis.addEventListener('scroll', update, true);
  globalThis.addEventListener('resize', update);
  sliderHighlightCleanup = () => {
    globalThis.removeEventListener('scroll', update, true);
    globalThis.removeEventListener('resize', update);
    host.remove();
  };
  return target;
}

interface Point { left: number; top: number }

function overlapArea(left: number, top: number, width: number, height: number, rect: DOMRect): number {
  const overlapWidth = Math.max(0, Math.min(left + width, rect.right) - Math.max(left, rect.left));
  const overlapHeight = Math.max(0, Math.min(top + height, rect.bottom) - Math.max(top, rect.top));
  return overlapWidth * overlapHeight;
}

function position(host: HTMLElement, anchor: Element | undefined, presentation: StatusPresentation): void {
  const width = Math.min(304, Math.max(240, globalThis.innerWidth - 24));
  const height = Math.min(220, host.getBoundingClientRect().height || 112);
  Object.assign(host.style, { width: `${width}px`, right: 'auto', bottom: 'auto' });
  if (presentation === 'toast') {
    Object.assign(host.style, { left: `${Math.max(12, globalThis.innerWidth - width - 12)}px`, top: '12px' });
    return;
  }
  if (globalThis.innerWidth <= 600) {
    Object.assign(host.style, { left: '12px', top: 'auto', bottom: '12px' });
    return;
  }

  const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : undefined;
  const fallback: Point = { left: Math.max(12, globalThis.innerWidth - width - 12), top: Math.max(12, globalThis.innerHeight - height - 12) };
  if (rect === undefined) {
    Object.assign(host.style, { left: `${fallback.left}px`, top: `${fallback.top}px` });
    return;
  }
  const clampLeft = (value: number) => Math.min(Math.max(12, value), Math.max(12, globalThis.innerWidth - width - 12));
  const clampTop = (value: number) => Math.min(Math.max(12, value), Math.max(12, globalThis.innerHeight - height - 12));
  const candidates: Point[] = [
    { left: rect.right + 10, top: rect.top },
    { left: rect.left - width - 10, top: rect.top },
    { left: rect.left, top: rect.bottom + 10 },
    { left: rect.left, top: rect.top - height - 10 },
  ];
  const form = anchor?.closest('form') ?? null;
  if (form !== null) {
    const formRect = form.getBoundingClientRect();
    candidates.push(
      { left: formRect.right + 12, top: formRect.top },
      { left: formRect.left - width - 12, top: formRect.top },
      { left: formRect.left, top: formRect.bottom + 12 },
      { left: formRect.left, top: formRect.top - height - 12 },
    );
  }
  candidates.push(fallback);
  const blockers = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"], input[type="button"], input[type="submit"], input[type="image"]'))
    .filter((element) => element.isConnected && element.getClientRects().length > 0)
    .map((element) => element.getBoundingClientRect());
  const ranked = candidates.map((candidate, index) => {
    const left = clampLeft(candidate.left);
    const top = clampTop(candidate.top);
    const displacement = Math.abs(left - candidate.left) + Math.abs(top - candidate.top);
    const overlap = blockers.reduce((total, blocker) => total + overlapArea(left, top, width, height, blocker), 0);
    return { left, top, score: overlap * 100 + displacement * 10 + index };
  }).sort((left, right) => left.score - right.score);
  const best = ranked[0] ?? fallback;
  Object.assign(host.style, { left: `${best.left}px`, top: `${best.top}px` });
}

function show(
  message: string,
  anchor: Element | undefined,
  tone: StatusTone,
  actions: readonly StatusAction[] = [],
  options: { timeoutMs?: number; onDismiss?: () => void; detail?: string; presentation?: StatusPresentation; nonInteractive?: boolean; statusKind?: 'workflow' | 'slider' | 'slider-user-active' } = {},
): void {
  clearCurrent();
  const host = document.createElement('div');
  host.dataset.localCaptchaStatus = 'true';
  host.style.position = 'fixed';
  host.style.zIndex = '2147483000';
  host.style.pointerEvents = 'none';
  const presentation = options.presentation ?? 'panel';
  host.dataset.presentation = presentation;
  if (options.statusKind) {
    host.dataset.statusKind = options.statusKind;
    currentStatusKind = options.statusKind;
  }
  if (anchor?.isConnected) host.dataset.anchor = 'candidate';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host { color-scheme: light dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; letter-spacing: 0; }
      .panel { pointer-events: auto; display: grid; grid-template-columns: 28px minmax(0,1fr) auto; gap: 10px; align-items: start; padding: 12px; color: #202522; background: rgba(252,253,252,.98); border: 1px solid #d9dedb; border-radius: 8px; box-shadow: 0 12px 32px rgba(31,44,36,.16), 0 2px 8px rgba(31,44,36,.08); animation: enter .18s ease-out; }
      .panel[data-presentation="toast"] { grid-template-columns: 24px minmax(0,1fr); align-items: center; padding: 10px 12px; box-shadow: 0 8px 24px rgba(31,44,36,.14); }
      .panel[data-presentation="toast"] .icon { width: 24px; height: 24px; border-radius: 6px; font-size: 13px; }
      .panel[data-presentation="toast"] .content { padding-top: 0; }
      .icon { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 7px; color: #3f5f4b; background: #eaf0ec; font: 600 15px/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
      .panel[data-tone="success"] .icon { color: #21623b; background: #e3f2e8; }
      .panel[data-tone="warning"] .icon { color: #765512; background: #f8edcf; }
      .panel[data-status-kind="slider-user-active"] { border: 2px solid #e08a00; box-shadow: 0 0 0 4px rgba(240,140,0,.18), 0 14px 34px rgba(122,76,0,.24); }
      .panel[data-status-kind="slider-user-active"] .icon { color: #704300; background: #ffe3a3; animation: pulse 1.15s ease-in-out infinite; }
      .panel[data-non-interactive="true"] { pointer-events: none; }
      .panel[data-tone="error"] .icon { color: #922f2b; background: #f8e5e3; }
      .panel[data-tone="running"] .icon { animation: pulse 1s ease-in-out infinite; }
      .content { min-width: 0; padding-top: 3px; }
      .message, .detail { margin: 0; overflow-wrap: anywhere; letter-spacing: 0; }
      .message { color: inherit; font-size: 13px; font-weight: 600; line-height: 1.45; }
      .detail { margin-top: 3px; color: #646d67; font-size: 12px; line-height: 1.45; }
      .close { width: 28px; height: 28px; display: grid; place-items: center; margin: 0; padding: 0; border: 0; border-radius: 6px; color: #68716b; background: transparent; cursor: pointer; font: 18px/1 ui-sans-serif, sans-serif; transition: background .16s ease, color .16s ease, transform .16s ease; }
      .close[hidden] { display: none; }
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
        .panel[data-status-kind="slider-user-active"] { border-color: #e5a63b; box-shadow: 0 0 0 4px rgba(229,166,59,.2), 0 14px 34px rgba(0,0,0,.4); }
        .panel[data-status-kind="slider-user-active"] .icon { color: #ffe2a3; background: #61491e; }
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
    <section class="panel" data-tone="${tone}" data-presentation="${presentation}" data-non-interactive="${options.nonInteractive === true}" data-status-kind="${options.statusKind ?? ''}" role="status" aria-live="polite">
      <span class="icon" aria-hidden="true">${ICONS[tone]}</span>
      <div class="content"><p class="message"></p><p class="detail" hidden></p></div>
      <button class="close" type="button" aria-label="${localized('关闭', 'Close')}">×</button>
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
      if (nextMessage) show(nextMessage, anchor, succeeded ? 'success' : 'error', [], { timeoutMs: 1800, presentation: 'toast', statusKind: options.statusKind });
    });
    actionsElement.append(button);
  }
  if (actions.length === 0) actionsElement.remove();
  if (presentation === 'toast' || (actions.length === 0 && options.onDismiss === undefined && (options.timeoutMs ?? 0) > 0)) close.hidden = true;
  document.body.append(host);
  const updatePosition = () => position(host, anchor, presentation);
  updatePosition();
  requestAnimationFrame(updatePosition);
  globalThis.addEventListener('scroll', updatePosition, true);
  globalThis.addEventListener('resize', updatePosition);
  positionCleanup = () => {
    globalThis.removeEventListener('scroll', updatePosition, true);
    globalThis.removeEventListener('resize', updatePosition);
  };
  const timeoutMs = options.timeoutMs ?? (presentation === 'toast' ? 2400 : 0);
  if (timeoutMs > 0) removalTimer = setTimeout(clearCurrent, timeoutMs);
}

export function showRecognizing(anchor?: Element, stage: 'preparing' | 'recognizing' = 'recognizing'): void {
  show(stage === 'preparing' ? localized('正在准备本地模型', 'Preparing the local model') : localized('正在识别验证码', 'Recognizing CAPTCHA'), anchor, 'running', [], { timeoutMs: 0, statusKind: 'workflow' });
}

export function showWorkflowStatus(
  result: WorkflowResult,
  anchor?: Element,
  legacyConfirmOrOptions?: (() => void) | WorkflowStatusOptions,
  legacyCopyOutcome?: CopyOutcome,
): void {
  const options: WorkflowStatusOptions = typeof legacyConfirmOrOptions === 'function'
    ? { actions: [{ label: localized('填入', 'Fill'), kind: 'primary', onClick: legacyConfirmOrOptions, successMessage: localized('已填入验证码', 'CAPTCHA filled') }], copyOutcome: legacyCopyOutcome }
    : { ...(legacyConfirmOrOptions ?? {}), copyOutcome: legacyConfirmOrOptions?.copyOutcome ?? legacyCopyOutcome };
  const value = 'displayText' in result ? result.displayText || result.fillValue : '';
  if (result.state === 'filled') {
    show(localized('已自动填入验证码', 'CAPTCHA filled automatically'), anchor, 'success', [], { timeoutMs: 1800, detail: value, presentation: 'toast', statusKind: 'workflow' });
    return;
  }
  if (result.state === 'needs_confirmation') {
    const detail = result.fillValue === undefined ? localized('未得到可安全使用的结果', 'No safe result was produced') : value;
    const confirmations = statusLocale === 'zh_CN' ? CONFIRMATION_MESSAGES : EN_CONFIRMATION_MESSAGES;
    show(result.reason === undefined ? localized('结果需要确认', 'The result needs confirmation') : confirmations[result.reason], anchor, 'warning', options.actions, { detail, onDismiss: options.onDismiss, statusKind: 'workflow' });
    return;
  }
  if (result.state === 'no_field') {
    const copyDetail = options.copyOutcome === 'copied' ? localized('已复制到剪贴板', 'Copied to the clipboard') : options.copyOutcome === 'failed' ? localized('自动复制失败', 'Automatic copy failed') : localized('未找到对应输入框', 'No matching input was found');
    const title = options.copyOutcome === 'copied' ? localized('识别完成并已复制', 'Recognized and copied') : options.actions?.length ? localized('识别完成，请选择操作', 'Recognition complete; choose an action') : localized('识别完成', 'Recognition complete');
    const presentation: StatusPresentation = options.copyOutcome === 'copied' && (options.actions?.length ?? 0) === 0 ? 'toast' : 'panel';
    show(title, anchor, options.copyOutcome === 'failed' ? 'error' : options.copyOutcome === 'copied' ? 'success' : 'neutral', options.actions, { detail: `${value} · ${copyDetail}`, onDismiss: options.onDismiss, presentation, statusKind: 'workflow' });
    return;
  }
  const retryable = result.state === 'recognition_failed' || result.state === 'image_unavailable' || result.state === 'permission_denied' || result.state === 'model_unavailable';
  const tone: StatusTone = retryable ? 'error' : result.state === 'stale' ? 'warning' : 'neutral';
  const persistent = retryable || result.state === 'ambiguous_image';
  show((statusLocale === 'zh_CN' ? ZH_MESSAGES : EN_MESSAGES)[result.state], anchor, tone, options.actions, {
    timeoutMs: persistent ? 0 : 3200,
    onDismiss: options.onDismiss,
    presentation: persistent ? 'panel' : 'toast',
    statusKind: 'workflow',
  });
}

export function showSliderStatus(result: SliderRunResult | { state: 'running' }): void {
  const state = result.state;
  const userActive = state === 'user-active';
  if (userActive && currentStatusKind === 'slider-user-active') return;
  const message = state === 'running' ? localized('Captcha Helper 正在接管滑块', 'Captcha Helper is taking over the slider')
    : state === 'success' ? localized('滑块已自动完成', 'Slider drag completed')
      : state === 'low-confidence' ? localized('未执行自动拖动', 'Automatic drag was not sent')
        : state === 'page-inactive' ? localized('已等待页面恢复', 'Waiting for the page to become active')
          : state === 'user-active' ? localized('检测到你的操作，已暂停自动拖动', 'Your input was detected; automatic drag is paused')
            : state === 'permission-denied' ? localized('自动拖动权限不可用', 'Automatic drag permission is unavailable')
              : state === 'not-found' || state === 'unsupported' ? localized('滑块已变化，本次未拖动', 'The slider changed before it could be dragged')
                : localized('本次自动拖动未完成', 'Automatic drag did not complete');
  const detail = state === 'running' ? localized('正在自动定位并拖动，请稍候。', 'Locating and dragging automatically.')
    : state === 'success' ? localized('Captcha Helper 已完成本次拖动。', 'Captcha Helper completed this drag.')
      : state === 'low-confidence' ? localized('定位结果不够确定，为避免误操作已停止。', 'The location was uncertain, so the extension stopped to avoid a wrong action.')
        : state === 'page-inactive' ? localized('返回当前页面后会再次检测。', 'The slider will be checked again when this page is active.')
          : state === 'user-active' ? localized('请先完成当前操作；停止操作后会继续检测滑块。', 'Finish your current action first; slider detection will resume when you stop.')
            : state === 'permission-denied' ? localized('没有向页面发送拖动操作。', 'No drag input was sent to the page.')
              : state === 'not-found' || state === 'unsupported' ? localized('没有向页面发送拖动操作。', 'No drag input was sent to the page.')
                : localized('操作已停止，可以手动完成当前验证。', 'The operation stopped; complete the current verification manually.');
  const warningStates: readonly SliderResultState[] = ['low-confidence', 'page-inactive', 'user-active', 'not-found', 'unsupported', 'uncertain'];
  const tone: StatusTone = state === 'running' ? 'running' : state === 'success' ? 'success' : warningStates.includes(state as SliderResultState) ? 'warning' : 'error';
  const timeoutMs = state === 'running' ? 0 : state === 'success' ? 2400 : state === 'permission-denied' ? 5000 : state === 'user-active' ? 0 : 4000;
  const anchor = userActive ? visibleSliderTarget() : undefined;
  show(message, anchor, tone, [], { detail, timeoutMs, presentation: userActive ? 'panel' : 'toast', nonInteractive: userActive, statusKind: userActive ? 'slider-user-active' : 'slider' });
  if (userActive) highlightSlider();
}

export function clearSliderUserActivityStatus(): void {
  if (currentStatusKind === 'slider-user-active') clearCurrent();
}

export function clearSliderStatus(): void {
  if (currentStatusKind === 'slider' || currentStatusKind === 'slider-user-active') clearCurrent();
}

export function clearWorkflowStatus(): void {
  if (currentStatusKind === 'workflow') clearCurrent();
}
