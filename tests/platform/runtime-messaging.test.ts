import { describe, expect, it } from 'vitest';

import { sendRuntimeMessage } from '../../src/platform/runtime-messaging';

describe('runtime messaging', () => {
  it('preserves Promise-based runtime.sendMessage responses', async () => {
    const runtime = {
      sendMessage: async (_message: unknown): Promise<unknown> => ({ ok: true }),
    };

    await expect(sendRuntimeMessage(runtime, { type: 'ping' })).resolves.toEqual({ ok: true });
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
