export interface RuntimeMessagePort {
  sendMessage(message: unknown, callback?: (response: unknown) => void): unknown;
  readonly lastError?: { readonly message?: string } | null;
}

export type RuntimeMessageHandler<Sender = unknown> = (message: unknown, sender: Sender) => unknown;
export type RuntimeMessageListener<Sender = unknown> = (message: unknown, sender: Sender, sendResponse?: (response: unknown) => void) => unknown;

function usesPromiseMessaging(runtime: RuntimeMessagePort): boolean {
  return (globalThis as typeof globalThis & { browser?: { runtime?: unknown } }).browser?.runtime === runtime;
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
}

export function createRuntimeMessageListener<Sender = unknown>(
  handler: RuntimeMessageHandler<Sender>,
  reportError?: (error: unknown) => void,
): RuntimeMessageListener<Sender> {
  return (message, sender, sendResponse) => {
    let response: unknown;
    try {
      response = handler(message, sender);
    } catch (error) {
      reportError?.(error);
      return undefined;
    }
    if (response === undefined) return undefined;
    if (!isPromiseLike(response)) {
      if (sendResponse === undefined) return response;
      sendResponse(response);
      return undefined;
    }
    if (sendResponse === undefined) return Promise.resolve(response);
    void Promise.resolve(response).then(sendResponse, (error: unknown) => {
      reportError?.(error);
      sendResponse(undefined);
    });
    return true;
  };
}

/** Bridges Chromium's callback-only runtime API and Promise-based WebExtension APIs. */
export function sendRuntimeMessage<T>(runtime: RuntimeMessagePort, message: unknown): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
    };
    const callback = (response: unknown): void => {
      const lastError = runtime.lastError;
      if (lastError !== undefined && lastError !== null) {
        finish(() => reject(new Error(lastError.message ?? 'Runtime message failed')));
        return;
      }
      finish(() => resolve(response as T));
    };

    let returned: unknown;
    try {
      returned = usesPromiseMessaging(runtime)
        ? runtime.sendMessage(message)
        : runtime.sendMessage(message, callback);
    } catch (error) {
      finish(() => reject(error));
      return;
    }

    if (isPromiseLike<T>(returned)) {
      returned.then(
        (response) => finish(() => resolve(response)),
        (error) => finish(() => reject(error)),
      );
    } else if (returned !== undefined) {
      finish(() => resolve(returned as T));
    }
  });
}
