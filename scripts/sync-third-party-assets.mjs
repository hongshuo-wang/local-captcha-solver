import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { replaceAssetSet } from './asset-file-set.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const upstreamAssets = [
  {
    repo: 'sml2h3/ddddocr',
    commit: 'c40f56f95412e10bcb9bd0bd24411e92f896d238',
    path: 'ddddocr/common_old.onnx',
    blob: '8ce4807e1e68c3fa5c1344d281cc7d1623a020cc',
    size: 13_606_051,
    output: 'public/models/common_old.onnx',
  },
  {
    repo: 'renhaoyeh/ddddocr-node',
    commit: 'f7be779568b08cbb3b12c895ce7f22fd6ccc554d',
    path: 'onnx/common_old.json',
    blob: 'bc50c087ee50455d364eaebd48a3a75fb58fee20',
    size: 90_091,
    output: 'public/models/common_old.json',
  },
  {
    repo: 'microsoft/onnxruntime',
    commit: 'a83fc4d58cb48eb68890dd689f94f28288cf2278',
    path: 'ThirdPartyNotices.txt',
    blob: '7b2bbdd2094d14e40338c7645b25a78ae8cd5364',
    size: 326_866,
    output: 'third_party/onnxruntime-ThirdPartyNotices.txt',
  },
];

const ortAssets = [
  {
    source: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
    size: 11_905_541,
    sha256: '45eaee27761ad883742a8d4b8fce1538d60ce43b51adf1726fafccc59b8c1a15',
    output: 'public/ort/ort-wasm-simd-threaded.wasm',
  },
  {
    source: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
    size: 20_321,
    sha256: '90a557d15c02bac4504d95b67f431d8594635ed2a0a62a7f2cd83d090ff91d3e',
    output: 'public/ort/ort-wasm-simd-threaded.mjs',
  },
];

const githubHeaders = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'local-captcha-solver-asset-sync',
  'X-GitHub-Api-Version': '2022-11-28',
};

const githubToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
if (githubToken) {
  githubHeaders.Authorization = `Bearer ${githubToken}`;
}

function describeError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const messages = [];
  const seen = new Set();
  let current = error;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    const code = typeof current.code === 'string' ? `${current.code} ` : '';
    messages.push(`${code}${current.message}`);
    current = current.cause;
  }
  return messages.join(': caused by ');
}

async function fetchJson(url, description) {
  let response;
  try {
    response = await fetch(url, { headers: githubHeaders });
  } catch (error) {
    throw new Error(`${description}: request failed: ${describeError(error)}`);
  }

  let body;
  try {
    body = await response.text();
  } catch (error) {
    throw new Error(`${description}: could not read response: ${describeError(error)}`);
  }

  if (!response.ok) {
    const detail = body.trim().slice(0, 300);
    throw new Error(
      `${description}: HTTP ${response.status} ${response.statusText}${detail ? `: ${detail}` : ''}`,
    );
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error(`${description}: malformed JSON response: ${describeError(error)}`);
  }
}

function requireObject(value, description) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${description}: expected a JSON object`);
  }
  return value;
}

function requireExact(actual, expected, field, description) {
  if (actual !== expected) {
    throw new Error(
      `${description}: expected ${field} ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function resolveRepoPath(path, description) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) {
    throw new Error(`${description}: expected a non-empty repository-relative path`);
  }

  const absolutePath = resolve(repoRoot, path);
  const relativePath = relative(repoRoot, absolutePath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${description}: path escapes repository root: ${JSON.stringify(path)}`);
  }
  return absolutePath;
}

function decodeBase64(content, description) {
  if (typeof content !== 'string') {
    throw new Error(`${description}: blob content must be a base64 string`);
  }

  const normalized = content.replace(/\s/g, '');
  if (normalized.length === 0 || normalized.length % 4 !== 0) {
    throw new Error(`${description}: malformed base64 blob content`);
  }

  let paddingLength = 0;
  if (normalized.endsWith('=')) {
    paddingLength = normalized.endsWith('==') ? 2 : 1;
  }

  const dataLength = normalized.length - paddingLength;
  for (let index = 0; index < dataLength; index += 1) {
    const code = normalized.charCodeAt(index);
    const isBase64Character =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47;
    if (!isBase64Character) {
      throw new Error(`${description}: malformed base64 blob content`);
    }
  }

  for (let index = dataLength; index < normalized.length; index += 1) {
    if (normalized.charCodeAt(index) !== 61) {
      throw new Error(`${description}: malformed base64 blob content`);
    }
  }

  const bytes = Buffer.from(normalized, 'base64');
  if (bytes.toString('base64') !== normalized) {
    throw new Error(`${description}: malformed base64 blob content`);
  }

  return bytes;
}

function gitBlobSha(bytes) {
  return createHash('sha1')
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest('hex');
}

async function downloadUpstreamAsset(asset) {
  const encodedPath = asset.path.split('/').map(encodeURIComponent).join('/');
  const metadataUrl = new URL(`https://api.github.com/repos/${asset.repo}/contents/${encodedPath}`);
  metadataUrl.searchParams.set('ref', asset.commit);
  const description = `${asset.repo}/${asset.path}@${asset.commit}`;
  const metadata = requireObject(
    await fetchJson(metadataUrl, `${description} contents metadata`),
    `${description} contents metadata`,
  );

  requireExact(metadata.path, asset.path, 'path', description);
  requireExact(metadata.sha, asset.blob, 'sha', description);
  requireExact(metadata.size, asset.size, 'size', description);

  const expectedGitUrl = `https://api.github.com/repos/${asset.repo}/git/blobs/${asset.blob}`;
  requireExact(metadata.git_url, expectedGitUrl, 'git_url', description);

  const blob = requireObject(
    await fetchJson(metadata.git_url, `${description} Git blob`),
    `${description} Git blob`,
  );
  requireExact(blob.encoding, 'base64', 'encoding', description);
  requireExact(blob.sha, asset.blob, 'blob sha', description);
  requireExact(blob.size, asset.size, 'blob size', description);

  const bytes = decodeBase64(blob.content, description);
  requireExact(bytes.byteLength, asset.size, 'decoded byte length', description);
  requireExact(gitBlobSha(bytes), asset.blob, 'computed Git blob SHA-1', description);

  return { output: asset.output, outputPath: resolveRepoPath(asset.output, description), bytes };
}

async function readOrtAsset(asset) {
  const sourcePath = resolveRepoPath(asset.source, asset.source);
  let sourceStat;
  try {
    sourceStat = await stat(sourcePath);
  } catch (error) {
    throw new Error(`${asset.source}: could not read ONNX Runtime source: ${describeError(error)}`);
  }

  if (!sourceStat.isFile()) {
    throw new Error(`${asset.source}: ONNX Runtime source is not a file`);
  }
  requireExact(sourceStat.size, asset.size, 'source size', asset.source);

  const bytes = await readFile(sourcePath);
  requireExact(bytes.byteLength, asset.size, 'read byte length', asset.source);
  requireExact(
    createHash('sha256').update(bytes).digest('hex'),
    asset.sha256,
    'source SHA-256',
    asset.source,
  );
  return {
    output: asset.output,
    outputPath: resolveRepoPath(asset.output, asset.source),
    bytes,
  };
}

async function main() {
  const outputs = await Promise.all([
    ...upstreamAssets.map(downloadUpstreamAsset),
    ...ortAssets.map(readOrtAsset),
  ]);

  await replaceAssetSet(outputs);
  for (const output of outputs) {
    console.log(`synced ${output.output} (${output.bytes.byteLength} bytes)`);
  }
}

main().catch((error) => {
  console.error(`Asset sync failed: ${describeError(error)}`);
  process.exitCode = 1;
});
