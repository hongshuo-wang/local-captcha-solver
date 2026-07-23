const size = 13_606_051;
const blob = '8ce4807e1e68c3fa5c1344d281cc7d1623a020cc';
const path = 'ddddocr/common_old.onnx';
const repo = 'sml2h3/ddddocr';
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
    return jsonResponse({
      encoding: 'base64',
      sha: blob,
      size,
      content: Buffer.alloc(size).toString('base64'),
    });
  }

  // Leave the second upstream request pending so the large-blob path determines the result.
  return new Promise(() => {});
};
