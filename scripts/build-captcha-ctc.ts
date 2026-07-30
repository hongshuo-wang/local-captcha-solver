import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parsePpOcrV6RuntimeConfig } from '../src/ocr/ppocrv6-engine';

export type ChromiumBuildTarget = 'chrome' | 'edge';

export const CAPTCHA_CTC_CANDIDATE = {
  id: 'paddle-ctc-v4-decoupled-320k',
  modelBytes: 2_242_324,
  modelSha256: 'bce3e791636f369dd8bbac9b4eee2a0d9515f001b89b422f6d250c33ee6bbc28',
  configBytes: 768,
  configSha256: 'efebc4c5e6a9de3d3cdf0a58d482a869f801352dd2ab8da73dc6f2baa8f29a5a',
} as const;

export function captchaCtcOutputDirectory(root: string, target: ChromiumBuildTarget): string {
  return path.join(root, '.output', `${target}-mv3-captcha-ctc`);
}

function verify(bytes: Uint8Array, expectedBytes: number, expectedSha256: string, name: string): void {
  if (bytes.byteLength !== expectedBytes) throw new Error(`${name} byte count mismatch`);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256) throw new Error(`${name} SHA-256 mismatch`);
}

async function runWxt(root: string, target: ChromiumBuildTarget): Promise<void> {
  const cli = path.join(root, 'node_modules', 'wxt', 'bin', 'wxt.mjs');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'build', '-b', target, '--mode', 'captcha-ctc'], {
      cwd: root,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`CAPTCHA CTC build failed (${signal ?? `exit ${String(code)}`})`));
    });
  });
}

export async function buildCaptchaCtcCandidate(root: string, target: ChromiumBuildTarget): Promise<void> {
  const source = path.join(
    root,
    'training',
    'ppocrv6-captcha',
    'output',
    CAPTCHA_CTC_CANDIDATE.id,
    'exported',
  );
  const [model, configBytes] = await Promise.all([
    readFile(path.join(source, 'captcha-ctc.onnx')),
    readFile(path.join(source, 'captcha-ctc.json')),
  ]);
  verify(model, CAPTCHA_CTC_CANDIDATE.modelBytes, CAPTCHA_CTC_CANDIDATE.modelSha256, 'CAPTCHA CTC model');
  verify(configBytes, CAPTCHA_CTC_CANDIDATE.configBytes, CAPTCHA_CTC_CANDIDATE.configSha256, 'CAPTCHA CTC config');
  const runtimeConfig = parsePpOcrV6RuntimeConfig(JSON.parse(configBytes.toString('utf8')));
  if (runtimeConfig.modelName !== 'captcha_ctc_tiny_71' || runtimeConfig.charset.length !== 71) {
    throw new Error('CAPTCHA CTC runtime contract mismatch');
  }

  await runWxt(root, target);
  const outputModels = path.join(captchaCtcOutputDirectory(root, target), 'models');
  await mkdir(outputModels, { recursive: true });
  await Promise.all([
    rm(path.join(outputModels, 'common_old.onnx'), { force: true }),
    rm(path.join(outputModels, 'common_old.json'), { force: true }),
  ]);
  await Promise.all([
    writeFile(path.join(outputModels, 'captcha-ctc.onnx'), model),
    writeFile(path.join(outputModels, 'captcha-ctc.json'), configBytes),
  ]);
  console.log(`CAPTCHA CTC ${target} candidate build: ${captchaCtcOutputDirectory(root, target)}`);
}

function targetFromArguments(argumentsList: readonly string[]): ChromiumBuildTarget {
  if (argumentsList.length !== 1 || (argumentsList[0] !== 'chrome' && argumentsList[0] !== 'edge')) {
    throw new Error('Usage: build-captcha-ctc.ts <chrome|edge>');
  }
  return argumentsList[0];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildCaptchaCtcCandidate(root, targetFromArguments(process.argv.slice(2)));
}
