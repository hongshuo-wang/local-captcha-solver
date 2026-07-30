import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const sourceRoot = process.env.ASSET_FIXTURE_ROOT;
if (!sourceRoot) {
  throw new Error('ASSET_FIXTURE_ROOT is required');
}

const assets = [
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
