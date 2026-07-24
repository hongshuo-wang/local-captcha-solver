import { createInferenceHost } from '../src/background/inference-host';
import type { InferenceBrowser } from '../src/background/inference-host';

interface RuntimeWithContexts {
  getContexts?: InferenceBrowser['runtime']['getContexts'];
}

interface BrowserWithOffscreen {
  offscreen: InferenceBrowser['offscreen'];
}

export default defineBackground(() => {
  const runtime = browser.runtime as typeof browser.runtime & RuntimeWithContexts;
  const extensionBrowser: InferenceBrowser = {
    runtime: {
      getURL: runtime.getURL.bind(runtime),
      sendMessage: runtime.sendMessage.bind(runtime),
      getContexts: runtime.getContexts?.bind(runtime),
    },
    offscreen: (browser as unknown as BrowserWithOffscreen).offscreen,
  };

  createInferenceHost(extensionBrowser);
  console.info('Local CAPTCHA Solver background ready');
});
