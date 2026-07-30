import { afterEach, describe, expect, it, vi } from 'vitest';

import { copyText } from '../../src/content/clipboard';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('copyText', () => {
  it('uses the asynchronous clipboard API when available', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyText('1234')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('1234');
  });

  it('falls back to a temporary textarea when the clipboard API is unavailable', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

    await expect(copyText('验证码')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('reports a failed fallback without leaving a temporary node', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: vi.fn(() => false) });

    await expect(copyText('验证码')).resolves.toBe(false);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
