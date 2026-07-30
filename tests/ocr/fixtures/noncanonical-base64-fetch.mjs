const size = 326_866;
const blob = '7b2bbdd2094d14e40338c7645b25a78ae8cd5364';
const path = 'ThirdPartyNotices.txt';
const repo = 'microsoft/onnxruntime';
const gitUrl = `https://api.github.com/repos/${repo}/git/blobs/${blob}`;

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify(value),
  };
}

globalThis.fetch = async (input) => {
  const url = String(input);

  if (url.startsWith(`https://api.github.com/repos/${repo}/contents/`)) {
    return jsonResponse({ path, sha: blob, size, git_url: gitUrl });
  }

  if (url === gitUrl) {
    return jsonResponse({ encoding: 'base64', sha: blob, size, content: 'AB==' });
  }

  throw new Error(`Unexpected fixture URL: ${url}`);
};
