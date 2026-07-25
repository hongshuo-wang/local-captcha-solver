# Model Status Observability Design

## Goal

Make local OCR readiness visible before the first CAPTCHA action. The browser action icon and popup must expose the same model status, loading progress, user-facing execution history, and actionable failures.

## Scope

- Add a single background-owned model status snapshot.
- Reflect `loading`, `ready`, and `error` in the action badge.
- Show the snapshot and recent user-facing execution records in the popup.
- Add a popup retry action for failed warmup.
- Record only the latest 30 user-facing model/recognition outcomes in memory for the current browser runtime.

## Non-goals

- Persisting logs across browser restarts.
- Showing internal debug logs, stack traces, image data, or recognized CAPTCHA text.
- Uploading telemetry or recognition data.
- Changing recognition confidence policy or OCR model behavior.

## Architecture

`ModelStatusStore` lives in the background service worker and owns the current snapshot and bounded log list. It exposes synchronous reads, state transitions, and subscription notifications. The background runtime subscribes to transitions and maps them to `browser.action` badge calls. The runtime router answers popup snapshot and retry messages. The popup requests the snapshot on startup and renders it alongside the existing site toggle.

The inference host receives lifecycle callbacks from the background runtime. Warmup transitions are `loading -> ready` or `loading -> error`; a retry clears the previous error and starts the same warmup path. Recognition transitions append a concise success or failure record and leave model state unchanged unless the inference host reports `model_unavailable`.

## Status and log contract

```ts
type ModelStatus = 'loading' | 'ready' | 'error';

interface ModelStatusSnapshot {
  status: ModelStatus;
  progress: number | null;
  message: string;
  lastReadyAt?: number;
  lastError?: string;
  logs: readonly {
    at: number;
    kind: 'warmup' | 'recognition';
    outcome: 'started' | 'success' | 'failure';
    message: string;
    durationMs?: number;
  }[];
}
```

Progress is coarse and honest: `0` when queued, `50` while the offscreen/WASM/session path is initializing, and `100` only after a successful warmup. The UI must not imply a precise percentage that the runtime cannot measure.

User-facing messages are short Chinese summaries. Recognition success records duration and confidence band, not recognized text. Failure records the typed failure category and duration. Internal errors continue to be reported to the existing background error reporter only.

## Action badge mapping

- `loading`: badge text `…`, amber background.
- `ready`: badge text `✓`, green background.
- `error`: badge text `!`, red background.

Badge updates are best-effort and must not block recognition or popup responses. On browsers where badge APIs are unavailable in tests, the adapter is optional.

## Popup behavior

The popup header contains a status row with a semantic status label, progress bar, and a retry button shown only for `error`. The recent execution list is rendered below the existing site controls. Popup startup renders a loading placeholder, requests the snapshot, and renders the latest result. Retry disables the button until the background reports a new snapshot. Empty logs show a concise “暂无执行记录” message.

## Error handling

Warmup failures become `error` with a stable user-facing message and a log entry. A retry starts a fresh attempt and clears the prior error only after the new attempt begins. Runtime message validation rejects malformed snapshots and leaves the popup in a typed unavailable state. Badge failures are swallowed after being reported through the existing internal reporter.

## Testing

- Unit tests for bounded log retention, transitions, and snapshot immutability.
- Background runtime tests for startup warmup transitions, retry routing, and badge mapping.
- Popup view/controller tests for loading, ready, error/retry, progress, and user-facing logs.
- Existing recognition and site-toggle tests remain unchanged.
- Run `npm test`, `npm run typecheck`, `npm run build:edge`, and `git diff --check`.
