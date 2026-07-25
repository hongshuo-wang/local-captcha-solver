import { createRuntimeRouter, runWarmup, type RuntimeRouterAdapter, type RuntimeSender } from './runtime-router';
import type { ContentRegistration } from './content-registration';
import type { ContextMenu } from './context-menu';
import type { ModelStatus } from './model-status';

export interface BackgroundRuntimeAdapter extends RuntimeRouterAdapter {
  registration: ContentRegistration;
  contextMenu: ContextMenu;
  runtime: {
    onMessage: { addListener(listener: (message: unknown, sender: RuntimeSender) => Promise<unknown | undefined>): void };
    onStartup: { addListener(listener: () => void): void };
    onInstalled: { addListener(listener: () => void): void };
  };
  storage?: { onChanged: { addListener(listener: (changes: Record<string, unknown>, areaName: string) => void): void } };
  contextMenus: { onClicked: { addListener(listener: (info: Parameters<ContextMenu['handleClick']>[0], tab?: Parameters<ContextMenu['handleClick']>[1]) => void): void } };
  action?: {
    setBadgeText(details: { text: string }): Promise<void> | void;
    setBadgeBackgroundColor(details: { color: string }): Promise<void> | void;
  };
  reportError?(error: unknown): void;
}

export interface BackgroundRuntime { start(): Promise<void>; }

export function createBackgroundRuntime(adapter: BackgroundRuntimeAdapter): BackgroundRuntime {
  const router = createRuntimeRouter(adapter);
  const reportError = adapter.reportError ?? ((error: unknown) => console.error('Local CAPTCHA Solver background initialization failed', error));
  let initialized = false;
  let initializing: Promise<void> | undefined;
  let listenersRegistered = false;
  const reconcile = () => { void adapter.registration.reconcile().catch(reportError); };
  const badgeForStatus = (status: ModelStatus): { text: string; color: string } => {
    if (status === 'ready') return { text: '✓', color: '#188038' };
    if (status === 'error') return { text: '!', color: '#d93025' };
    return { text: '…', color: '#f9ab00' };
  };
  const updateBadge = (status: ModelStatus): void => {
    if (adapter.action === undefined) return;
    const badge = badgeForStatus(status);
    void Promise.resolve().then(() => adapter.action?.setBadgeText({ text: badge.text })).catch(reportError);
    void Promise.resolve().then(() => adapter.action?.setBadgeBackgroundColor({ color: badge.color })).catch(reportError);
  };

  return {
    async start(): Promise<void> {
      if (initialized) return;
      if (initializing !== undefined) return initializing;
      if (!listenersRegistered) {
        listenersRegistered = true;
        adapter.modelStatus.subscribe((snapshot) => updateBadge(snapshot.status));
        adapter.runtime.onMessage.addListener((message, sender) => router.handle(message, sender));
        adapter.runtime.onStartup.addListener(reconcile);
        adapter.runtime.onInstalled.addListener(reconcile);
        adapter.storage?.onChanged.addListener((changes, areaName) => { if (areaName === 'local' && Object.hasOwn(changes, 'captcha-settings')) reconcile(); });
        adapter.contextMenus.onClicked.addListener((info, tab) => { void adapter.contextMenu.handleClick(info, tab); });
      }
      void runWarmup(adapter)?.catch(reportError);
      const attempt = Promise.all([adapter.registration.reconcile(), adapter.contextMenu.install()]).then(() => { initialized = true; }, reportError);
      initializing = attempt;
      await attempt;
      if (!initialized) initializing = undefined;
    },
  };
}
