import { createRuntimeRouter, type RuntimeRouterAdapter, type RuntimeSender } from './runtime-router';
import type { ContentRegistration } from './content-registration';
import type { ContextMenu } from './context-menu';

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

  return {
    async start(): Promise<void> {
      if (initialized) return;
      if (initializing !== undefined) return initializing;
      if (!listenersRegistered) {
        listenersRegistered = true;
        adapter.runtime.onMessage.addListener((message, sender) => router.handle(message, sender));
        adapter.runtime.onStartup.addListener(reconcile);
        adapter.runtime.onInstalled.addListener(reconcile);
        adapter.storage?.onChanged.addListener((changes, areaName) => { if (areaName === 'local' && Object.hasOwn(changes, 'captcha-settings')) reconcile(); });
        adapter.contextMenus.onClicked.addListener((info, tab) => { void adapter.contextMenu.handleClick(info, tab); });
      }
      const attempt = Promise.all([adapter.registration.reconcile(), adapter.contextMenu.install()]).then(() => { initialized = true; }, reportError);
      initializing = attempt;
      await attempt;
      if (!initialized) initializing = undefined;
    },
  };
}
