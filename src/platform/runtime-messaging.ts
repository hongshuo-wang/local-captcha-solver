export interface RuntimeMessagePort {
  sendMessage(message: unknown, callback?: (response: unknown) => void): unknown;
  readonly lastError?: { readonly message?: string } | null;
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function';
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
      returned = runtime.sendMessage(message, callback);
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
