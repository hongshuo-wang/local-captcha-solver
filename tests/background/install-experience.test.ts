import { describe, expect, it, vi } from 'vitest';

import { registerInstallExperience } from '../../src/background/install-experience';

describe('install experience', () => {
  it('opens the standalone onboarding tab only after a fresh installation', async () => {
    let listener!: (details: { reason: string }) => void;
    const create = vi.fn(async () => undefined);
    registerInstallExperience({
      onInstalled: { addListener(next) { listener = next; } },
      getURL: (path) => `chrome-extension://test/${path}`,
    }, { create });
    listener({ reason: 'update' });
    expect(create).not.toHaveBeenCalled();
    listener({ reason: 'install' });
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith({ url: 'chrome-extension://test/onboarding.html' }));
  });
});
