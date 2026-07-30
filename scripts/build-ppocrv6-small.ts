import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse } from 'yaml';

import {
  PPOCRV6_ASSETS,
  assetPaths,
  verifyAssetBytes,
} from '../benchmark/ppocrv6-assets';

export function ppocrv6SmallOutputDirectory(root: string): string {
  return path.join(root, '.output', 'chrome-mv3-ppocrv6-small');
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function createPpOcrV6RuntimeConfig(configText: string) {
  const root = object(parse(configText), 'inference.yml');
  const global = object(root.Global, 'Global');
  if (global.model_name !== PPOCRV6_ASSETS.small.modelName) {
    throw new TypeError('Experience build requires the pinned PP-OCRv6 small model');
  }
  const preProcess = object(root.PreProcess, 'PreProcess');
  if (!Array.isArray(preProcess.transform_ops)) throw new TypeError('PreProcess.transform_ops must be an array');
  const resizeEntry = preProcess.transform_ops.find((entry) => (
    entry !== null && typeof entry === 'object' && !Array.isArray(entry) && Object.hasOwn(entry, 'RecResizeImg')
  ));
  const resize = object(resizeEntry && object(resizeEntry, 'transform op').RecResizeImg, 'RecResizeImg');
  if (
    !Array.isArray(resize.image_shape)
    || resize.image_shape.length !== 3
    || resize.image_shape[0] !== 3
    || resize.image_shape.some((value) => !Number.isSafeInteger(value) || value <= 0)
  ) throw new TypeError('RecResizeImg.image_shape must be [3, height, width]');
  const postProcess = object(root.PostProcess, 'PostProcess');
  if (postProcess.name !== 'CTCLabelDecode' || !Array.isArray(postProcess.character_dict)) {
    throw new TypeError('PostProcess must provide a CTCLabelDecode character_dict');
  }
  if (postProcess.character_dict.some((character) => typeof character !== 'string' || character === '')) {
    throw new TypeError('PostProcess.character_dict entries must be nonempty strings');
  }
  return {
    schemaVersion: 1 as const,
    modelName: global.model_name,
    imageShape: resize.image_shape as [3, number, number],
    charset: ['', ...(postProcess.character_dict as string[]), ' '],
  };
}

async function runWxt(root: string): Promise<void> {
  const cli = path.join(root, 'node_modules', 'wxt', 'bin', 'wxt.mjs');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'build', '-b', 'chrome', '--mode', 'ppocrv6-small'], {
      cwd: root,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`WXT experience build failed (${signal ?? `exit ${String(code)}`})`));
    });
  });
}

export async function buildPpOcrV6SmallExperience(root: string): Promise<void> {
  const asset = PPOCRV6_ASSETS.small;
  const source = assetPaths(root, 'small');
  let model: Uint8Array;
  let configText: string;
  try {
    [model, configText] = await Promise.all([
      readFile(source.model),
      readFile(source.config, 'utf8'),
    ]);
  } catch (cause) {
    throw new Error('PP-OCRv6 small assets are missing; run npm run benchmark:ppocrv6:fetch first', { cause });
  }
  verifyAssetBytes(model, asset.modelBytes, asset.modelSha256, `${asset.modelName} model`);
  verifyAssetBytes(Buffer.from(configText), asset.configBytes, asset.configSha256, `${asset.modelName} config`);
  const runtimeConfig = createPpOcrV6RuntimeConfig(configText);

  await runWxt(root);
  const output = ppocrv6SmallOutputDirectory(root);
  const outputModels = path.join(output, 'models');
  await mkdir(outputModels, { recursive: true });
  await Promise.all([
    rm(path.join(outputModels, 'common_old.onnx'), { force: true }),
    rm(path.join(outputModels, 'common_old.json'), { force: true }),
  ]);
  await Promise.all([
    writeFile(path.join(outputModels, 'ppocrv6-small.onnx'), model),
    writeFile(path.join(outputModels, 'ppocrv6-small.json'), `${JSON.stringify(runtimeConfig)}\n`),
  ]);
  console.log(`PP-OCRv6 small experience build: ${output}`);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await buildPpOcrV6SmallExperience(root);
}
