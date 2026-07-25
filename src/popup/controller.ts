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

function isSiteChanged(value: unknown): boolean {
  return typeof value === 'object' && value !== null &&
    (value as { enabled?: unknown }).enabled === false &&
    (value as { reason?: unknown }).reason === 'site-changed';
}

export function createPopupController(adapter: PopupControllerAdapter, view: PopupView): PopupController {
  let hostname = 'Loading site...';
  let supported = false;
  let knownEnabled = false;
  let stateKnown = false;
  let operationGeneration = 0;

  const isCurrent = (generation: number): boolean => generation === operationGeneration;
  const render = (generation: number, state: Omit<PopupViewState, 'hostname'>): void => {
    if (isCurrent(generation)) view.render({ hostname, ...state });
  };
  const renderKnown = (generation: number, error?: string, status = knownEnabled ? ON_STATUS : OFF_STATUS): void => render(generation, { checked: knownEnabled, disabled: false, status, error });

  const start = async (): Promise<void> => {
      const generation = ++operationGeneration;
      render(generation, { checked: false, disabled: true, status: 'Checking site setting...' });
      stateKnown = false;
      try {
        const tabs = await adapter.tabs.query({ active: true, currentWindow: true });
        if (!isCurrent(generation)) return;
        const pageUrl = tabs[0]?.url;
        if (typeof pageUrl !== 'string') throw new Error('unsupported');
        hostname = hostnameForPage(pageUrl);
        supported = true;
      } catch {
        if (!isCurrent(generation)) return;
        hostname = 'Unsupported page';
        supported = false;
        render(generation, { checked: false, disabled: true, status: UNSUPPORTED_STATUS });
        return;
      }

      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:get-site-state' });
        if (!isCurrent(generation)) return;
        if (!isSiteState(response)) throw new Error('malformed');
        knownEnabled = response.enabled;
        stateKnown = true;
        renderKnown(generation);
      } catch {
        if (!isCurrent(generation)) return;
        knownEnabled = false;
        render(generation, { checked: false, disabled: true, status: OFF_STATUS, error: 'Could not load this site setting.' });
      }
    };

  return {
    start,
    async setEnabled(enabled: boolean): Promise<void> {
      if (!supported || !stateKnown) return;
      const generation = ++operationGeneration;
      const requestHostname = hostname;
      render(generation, { checked: knownEnabled, disabled: true, status: 'Updating site setting...' });
      try {
        const response = await adapter.runtime.sendMessage({ type: 'captcha:set-site-enabled', enabled, hostname: requestHostname });
        if (!isCurrent(generation)) return;
        if (enabled && isSiteState(response) && response.enabled) {
          knownEnabled = true;
          renderKnown(generation);
          return;
        }
        if (enabled && isPermissionDenied(response)) {
          renderKnown(generation, 'Permission was not granted for this site.');
          return;
        }
        if (isSiteChanged(response)) {
          await start();
          return;
        }
        if (!enabled && isDisableState(response)) {
          knownEnabled = false;
          renderKnown(generation, undefined, response.permissionRemoved ? OFF_STATUS : `${OFF_STATUS} Site permission could not be removed.`);
          return;
        }
        throw new Error('malformed');
      } catch {
        if (!isCurrent(generation)) return;
        renderKnown(generation, 'Could not update this site setting.');
      }
    },
  };
}
