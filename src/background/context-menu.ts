export const CONTEXT_MENU_ID = 'captcha-recognize-image';

interface MenuClickInfo { menuItemId?: string | number; srcUrl?: string; frameId?: number; }
interface TabIdentity { id?: number; url?: string; }

export interface ContextMenuAdapter {
  contextMenus: {
    create(details: { id: string; title: string; contexts: readonly ['image'] }): unknown;
    remove(id: string): Promise<void>;
    onClicked: { addListener(listener: (info: MenuClickInfo, tab?: TabIdentity) => void): void };
  };
  tabs: { sendMessage(tabId: number, message: unknown, options?: { frameId: number }): Promise<unknown> };
  scripting: { executeScript(details: { target: { tabId: number; frameIds?: readonly number[] }; files: readonly string[] }): Promise<unknown> };
}

export interface ContextMenu { install(): Promise<void>; handleClick(info: MenuClickInfo, tab?: TabIdentity): Promise<{ state: 'sent' | 'unsupported' }>; }

function httpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; }
}

function imageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (/^(?:data:image\/|blob:)/i.test(value)) return true;
  return httpUrl(value);
}

export function createContextMenu(adapter: ContextMenuAdapter): ContextMenu {
  const send = async (tabId: number, message: unknown, frameId: number | undefined) => adapter.tabs.sendMessage(tabId, message, frameId === undefined ? undefined : { frameId });
  return {
    async install(): Promise<void> {
      try { await adapter.contextMenus.remove(CONTEXT_MENU_ID); } catch { /* The initial remove commonly has no matching item. */ }
      adapter.contextMenus.create({ id: CONTEXT_MENU_ID, title: '识别并填充验证码', contexts: ['image'] });
    },
    async handleClick(info: MenuClickInfo, tab?: TabIdentity): Promise<{ state: 'sent' | 'unsupported' }> {
      if (info.menuItemId !== CONTEXT_MENU_ID || tab?.id === undefined || !httpUrl(tab.url) || !imageUrl(info.srcUrl)) return { state: 'unsupported' };
      try {
        try { await send(tab.id, { type: 'captcha:ping' }, info.frameId); } catch {
          await adapter.scripting.executeScript({ target: { tabId: tab.id, ...(info.frameId === undefined ? {} : { frameIds: [info.frameId] }) }, files: ['content-scripts/content.js'] });
        }
        await send(tab.id, { type: 'captcha:context-image', srcUrl: info.srcUrl, tabId: tab.id, ...(info.frameId === undefined ? {} : { frameId: info.frameId }) }, info.frameId);
        return { state: 'sent' };
      } catch { return { state: 'unsupported' }; }
    },
  };
}
