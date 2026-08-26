import { describe, expect, it, vi } from 'vitest';

import { createRuntimeMessageListener, sendRuntimeMessage } from '../../src/platform/runtime-messaging';

describe('runtime messaging', () => {
  it('bridges Promise responses through callback-only message listeners', async () => {
    const sendResponse = vi.fn();
    const listener = createRuntimeMessageListener(async (message) => ({ echo: message }));

    expect(listener({ type: 'ping' }, {}, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith({ echo: { type: 'ping' } }));
  });

  it('preserves Promise responses when a listener runtime does not expose sendResponse', async () => {
    const listener = createRuntimeMessageListener(async () => ({ ok: true }));
    await expect(listener({ type: 'ping' }, {})).resolves.toEqual({ ok: true });
  });

  it('preserves Promise-based runtime.sendMessage responses', async () => {
    const runtime = {
      sendMessage: async (_message: unknown): Promise<unknown> => ({ ok: true }),
    };

    await expect(sendRuntimeMessage(runtime, { type: 'ping' })).resolves.toEqual({ ok: true });
  });

  it('uses the Promise-only signature for Firefox browser runtimes', async () => {
    const runtime = {
      sendMessage: vi.fn(async (_message: unknown, callback?: (response: unknown) => void): Promise<unknown> => {
        if (callback !== undefined) throw new TypeError('callbacks are not supported');
        return { ok: true };
      }),
    };
    vi.stubGlobal('browser', { runtime });

    await expect(sendRuntimeMessage(runtime, { type: 'ping' })).resolves.toEqual({ ok: true });
    expect(runtime.sendMessage).toHaveBeenCalledWith({ type: 'ping' });
    vi.unstubAllGlobals();
  });

  it('resolves callback-only runtime.sendMessage responses', async () => {
    const runtime = {
      sendMessage(_message: unknown, callback?: (response: unknown) => void): undefined {
        queueMicrotask(() => callback?.({ ok: true }));
        return undefined;
      },
    };

    await expect(sendRuntimeMessage(runtime, { type: 'ping' })).resolves.toEqual({ ok: true });
  });

  it('rejects callback-only runtime.lastError responses', async () => {
    const runtime: {
      lastError?: { message?: string };
      sendMessage(message: unknown, callback?: (response: unknown) => void): undefined;
    } = {
      sendMessage(_message, callback) {
        queueMicrotask(() => {
          runtime.lastError = { message: 'The message port closed' };
          callback?.(undefined);
          runtime.lastError = undefined;
        });
        return undefined;
      },
    };

    await expect(sendRuntimeMessage(runtime, { type: 'ping' })).rejects.toThrow('The message port closed');
  });
});
