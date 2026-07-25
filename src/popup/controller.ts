import { hostnameForPage } from '../platform/settings-store';

export interface PopupViewState {
  hostname: string;
  checked: boolean;
  disabled: boolean;
  status: string;
  error?: string;
}

export interface PopupView {
  render(state: PopupViewState): void;
}

export interface PopupControllerAdapter {
  tabs: { query(queryInfo: { active: boolean; currentWindow: boolean }): Promise<readonly { url?: unknown }[]> };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
}

export interface PopupController {
  start(): Promise<void>;
  setEnabled(enabled: boolean): Promise<void>;
}

type SiteState = { enabled: boolean };
type DisableState = { disabled: true; permissionRemoved: boolean };

const OFF_STATUS = 'Automatic recognition is off.';
const ON_STATUS = 'Automatic recognition is on.';
const UNSUPPORTED_STATUS = 'Automatic recognition is unavailable on this page.';

function isSiteState(value: unknown): value is SiteState {
  return typeof value === 'object' && value !== null &&
    ((value as { enabled?: unknown }).enabled === true || (value as { enabled?: unknown }).enabled === false);
}

function isDisableState(value: unknown): value is DisableState {
  return typeof value === 'object' && value !== null && (value as { disabled?: unknown }).disabled === true && typeof (value as { permissionRemoved?: unknown }).permissionRemoved === 'boolean';
}

function isPermissionDenied(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    (value as { enabled?: unknown }).enabled === false &&
    (value as { reason?: unknown }).reason === 'permission-denied';
}

export function createPopupController(adapter: PopupControllerAdapter, view: PopupView): PopupController {
  let hostname = 'Loading site...';
  let supported = false;
  let knownEnabled = false;

  const render = (state: Omit<PopupViewState, 'hostname'>): void => view.render({ hostname, ...state });
  const renderKnown = (error?: string, status = knownEnabled ? ON_STATUS : OFF_STATUS): void => render({ checked: knownEnabled, disabled: false, status, error });

  return {
    async start(): Promise<void> {
      render({ checked: false, disabled: true, status: 'Checking site setting...' });
      try {
        const tabs = await adapter.tabs.query({ active: true, currentWindow: true });
        const pageUrl = tabs[0]?.url;
        if (typeof pageUrl !== 'string') throw new Error('unsupported');
        hostname = hostnameForPage(pageUrl);
        supported = true;
      } catch {
        hostname = 'Unsupported page';
        supported = false;
        render({ checked: false, disabled: true, status: UNSUPPORTED_STATUS });
        return;
      }

      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:get-site-state' });
        if (!isSiteState(response)) throw new Error('malformed');
        knownEnabled = response.enabled;
        renderKnown();
      } catch {
        knownEnabled = false;
        render({ checked: false, disabled: false, status: OFF_STATUS, error: 'Could not load this site setting.' });
      }
    },

    async setEnabled(enabled: boolean): Promise<void> {
      if (!supported) return;
      render({ checked: knownEnabled, disabled: true, status: 'Updating site setting...' });
      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:set-site-enabled', enabled });
        if (enabled && isSiteState(response) && response.enabled) {
          knownEnabled = true;
          renderKnown();
          return;
        }
        if (enabled && isPermissionDenied(response)) {
          renderKnown('Permission was not granted for this site.');
          return;
        }
        if (!enabled && isDisableState(response)) {
          knownEnabled = false;
          renderKnown(undefined, response.permissionRemoved ? OFF_STATUS : `${OFF_STATUS} Site permission could not be removed.`);
          return;
        }
        throw new Error('malformed');
      } catch {
        renderKnown('Could not update this site setting.');
      }
    },
  };
}
