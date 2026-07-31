import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function versionFromStableTag(tag) {
  const match = stableTagPattern.exec(tag);
  if (!match) {
    throw new Error(`Release tag must be stable SemVer in the form vMAJOR.MINOR.PATCH: ${tag}`);
  }
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function extractChangelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const heading = `## [${version}]`;
  const start = lines.findIndex((line) => line === heading || line.startsWith(`${heading} - `));
  if (start === -1) {
    throw new Error(`CHANGELOG.md has no section for ${version}`);
  }

  const nextSection = lines.findIndex(
    (line, index) => index > start && (/^## \[[^\]]+\]/.test(line) || /^\[[^\]]+\]:\s/.test(line)),
  );
  const end = nextSection === -1 ? lines.length : nextSection;
  const section = lines.slice(start + 1, end).join('\n').trim();
  if (!section) {
    throw new Error(`CHANGELOG.md section for ${version} is empty`);
  }
  return section;
}

async function main() {
  const tag = process.argv[2];
  if (!tag) {
    throw new Error('Usage: npm run release:prepare -- vMAJOR.MINOR.PATCH');
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = versionFromStableTag(tag);
  if (packageJson.version !== version) {
    throw new Error(`Tag ${tag} does not match package.json version ${packageJson.version}`);
  }

  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  const releaseNotes = extractChangelogSection(changelog, version);
  const output = path.join(root, '.output');
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'release-notes.md'), `${releaseNotes}\n`, 'utf8');
  console.log(`Prepared release notes for ${tag}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
