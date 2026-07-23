import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { CorpusSample } from './corpus';

export interface TesseractChildRequest {
  readonly root: string;
  readonly samples: readonly CorpusSample[];
  readonly workerPath: string;
  readonly corePath: string;
  readonly langPath: string;
}

export interface TesseractRecognition {
  readonly text: string;
  readonly confidence: number;
  readonly warmLatencyMs: number;
}

export interface TesseractChildResult {
  readonly coldInitMs: number;
  readonly recognitions: readonly TesseractRecognition[];
}

interface ChildLike {
  on(event: 'message', listener: (message: unknown) => void): this;
  on(event: 'error', listener: (error: Error) => void): this;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  off(event: 'message', listener: (message: unknown) => void): this;
  off(event: 'error', listener: (error: Error) => void): this;
  off(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
  send(message: unknown): unknown;
  kill(): unknown;
}

type SpawnChild = () => ChildLike;

function spawnTesseractChild(): ChildProcess {
  return fork(fileURLToPath(new URL('./tesseract-child.ts', import.meta.url)), [], {
    execArgv: ['--import', 'tsx'],
    env: { ...process.env, LOCAL_CAPTCHA_TESSERACT_CHILD: '1' },
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
}

export function runTesseractChild(
  request: TesseractChildRequest,
  spawnChild: SpawnChild = spawnTesseractChild,
): Promise<TesseractChildResult> {
  const child = spawnChild();
  const operation = new Promise<TesseractChildResult>((resolve, reject) => {
    const cleanup = () => {
      child.off('message', onMessage);
      child.off('error', onError);
      child.off('exit', onExit);
    };
    const fail = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onMessage = (value: unknown) => {
      if (value === null || typeof value !== 'object') {
        fail(new Error('Invalid response from Tesseract child'));
        return;
      }
      const message = value as Record<string, unknown>;
      if (message.type === 'error') {
        fail(new Error(String(message.error ?? 'Tesseract child failed')));
        return;
      }
      if (message.type === 'success') {
        cleanup();
        resolve({
          coldInitMs: message.coldInitMs as number,
          recognitions: message.recognitions as readonly TesseractRecognition[],
        });
      }
    };
    const onError = (error: Error) => fail(error);
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(new Error(`Tesseract child exited before responding (code=${code}, signal=${signal})`));
    };
    child.on('message', onMessage);
    child.on('error', onError);
    child.on('exit', onExit);
    child.send({ type: 'run', request });
  });
  return operation.finally(() => {
    child.kill();
  });
}
