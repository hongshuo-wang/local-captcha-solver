import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceRoot = process.env.ASSET_FIXTURE_ROOT;
if (!sourceRoot) {
  throw new Error('ASSET_FIXTURE_ROOT is required');
}

const assets = [
  {
    repo: 'sml2h3/ddddocr',
    commit: 'c40f56f95412e10bcb9bd0bd24411e92f896d238',
    path: 'ddddocr/common_old.onnx',
    blob: '8ce4807e1e68c3fa5c1344d281cc7d1623a020cc',
    size: 13_606_051,
    source: 'public/models/common_old.onnx',
  },
  {
    repo: 'renhaoyeh/ddddocr-node',
    commit: 'f7be779568b08cbb3b12c895ce7f22fd6ccc554d',
    path: 'onnx/common_old.json',
    blob: 'bc50c087ee50455d364eaebd48a3a75fb58fee20',
    size: 90_091,
    source: 'public/models/common_old.json',
  },
  {
    repo: 'microsoft/onnxruntime',
    commit: 'a83fc4d58cb48eb68890dd689f94f28288cf2278',
    path: 'ThirdPartyNotices.txt',
    blob: '7b2bbdd2094d14e40338c7645b25a78ae8cd5364',
    size: 326_866,
    source: 'third_party/onnxruntime-ThirdPartyNotices.txt',
  },
].map((asset) => ({
  ...asset,
  gitUrl: `https://api.github.com/repos/${asset.repo}/git/blobs/${asset.blob}`,
  contentsUrl: `https://api.github.com/repos/${asset.repo}/contents/${asset.path}`,
}));

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(value),
  };
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  const asset = assets.find(
    (candidate) =>
      (url.origin + url.pathname === candidate.contentsUrl &&
        url.searchParams.get('ref') === candidate.commit) ||
      url.origin + url.pathname === candidate.gitUrl,
  );

  if (!asset) {
    throw new Error(`Unexpected GitHub fixture URL: ${url}`);
  }

  if (url.origin + url.pathname === asset.contentsUrl) {
    return jsonResponse({
      path: asset.path,
      sha: asset.blob,
      size: asset.size,
      git_url: asset.gitUrl,
    });
  }

  const bytes = await readFile(resolve(sourceRoot, asset.source));
  return jsonResponse({
    encoding: 'base64',
    sha: asset.blob,
    size: asset.size,
    content: bytes.toString('base64'),
  });
};
