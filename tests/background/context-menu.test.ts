import { describe, expect, it, vi } from 'vitest';

import { CONTEXT_MENU_ID, createContextMenu } from '../../src/background/context-menu';

function harness() {
  const create = vi.fn(); const remove = vi.fn(async () => undefined); const addListener = vi.fn();
  const sendMessage = vi.fn(async () => ({ ok: true })); const executeScript = vi.fn(async () => undefined);
  return { create, remove, addListener, sendMessage, executeScript, menu: createContextMenu({ contextMenus: { create, remove, onClicked: { addListener } }, tabs: { sendMessage }, scripting: { executeScript } }) };
}

describe('image context menu', () => {
  it('creates exactly one image-only command idempotently', async () => {
    const app = harness();
    await app.menu.install(); await app.menu.install();
    expect(app.remove).toHaveBeenCalledWith(CONTEXT_MENU_ID);
    expect(app.create).toHaveBeenLastCalledWith({ id: CONTEXT_MENU_ID, title: '识别并填充验证码', contexts: ['image'] });
  });

  it('pings existing content before forwarding the selected image identity', async () => {
    const app = harness();
    await expect(app.menu.handleClick({ menuItemId: CONTEXT_MENU_ID, srcUrl: 'https://assets.example.test/captcha.png', frameId: 3 }, { id: 9, url: 'https://portal.example.test/login' })).resolves.toEqual({ state: 'sent' });
    expect(app.executeScript).not.toHaveBeenCalled();
    expect(app.sendMessage).toHaveBeenNthCalledWith(1, 9, { type: 'captcha:ping' }, { frameId: 3 });
    expect(app.sendMessage).toHaveBeenNthCalledWith(2, 9, { type: 'captcha:context-image', srcUrl: 'https://assets.example.test/captcha.png', tabId: 9, frameId: 3 }, { frameId: 3 });
  });

  it('injects only after a ping failure and rejects unsupported pages without throwing', async () => {
    const app = harness();
    app.sendMessage.mockRejectedValueOnce(new Error('not loaded'));
    await expect(app.menu.handleClick({ menuItemId: CONTEXT_MENU_ID, srcUrl: 'https://assets.example.test/captcha.png' }, { id: 9, url: 'https://portal.example.test/login' })).resolves.toEqual({ state: 'sent' });
    expect(app.executeScript).toHaveBeenCalledWith({ target: { tabId: 9 }, files: ['content-scripts/content.js'] });
    await expect(app.menu.handleClick({ menuItemId: CONTEXT_MENU_ID, srcUrl: 'https://assets.example.test/captcha.png' }, { id: 9, url: 'chrome://settings/' })).resolves.toEqual({ state: 'unsupported' });
  });

  it('forwards data and blob image URLs instead of silently rejecting them', async () => {
    const app = harness();
    await expect(app.menu.handleClick({ menuItemId: CONTEXT_MENU_ID, srcUrl: 'data:image/png;base64,AQ==' }, { id: 9, url: 'https://portal.example.test/login' })).resolves.toEqual({ state: 'sent' });
    await expect(app.menu.handleClick({ menuItemId: CONTEXT_MENU_ID, srcUrl: 'blob:https://portal.example.test/abc' }, { id: 9, url: 'https://portal.example.test/login' })).resolves.toEqual({ state: 'sent' });
  });

  it('returns an unsupported status when injection cannot run on the selected tab', async () => {
    const app = harness();
    app.sendMessage.mockRejectedValueOnce(new Error('not loaded')); app.executeScript.mockRejectedValueOnce(new Error('blocked'));
    await expect(app.menu.handleClick({ menuItemId: CONTEXT_MENU_ID, srcUrl: 'https://assets.example.test/captcha.png' }, { id: 9, url: 'https://portal.example.test/login' })).resolves.toEqual({ state: 'unsupported' });
  });
});
