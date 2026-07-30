import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPublicDataset } from '../../training/ppocrv6-captcha/fetch-public-dataset';
import {
  PUBLIC_DATASETS,
  publicDatasetArchivePath,
  validatePublicDatasetCatalog,
  verifyPublicDatasetArchive,
} from '../../training/ppocrv6-captcha/public-datasets';
import type {
  CandidatePublicDataset,
  VerifiedPublicDataset,
} from '../../training/ppocrv6-captcha/public-datasets';

const temporaryRoots = new Set<string>();

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'captcha-public-dataset-'));
  temporaryRoots.add(root);
  return root;
}

function verified(bytes: Uint8Array): VerifiedPublicDataset {
  return {
    id: 'fixture-v1',
    title: 'Fixture',
    pageUrl: 'https://example.test/fixture',
    kaggleRef: 'owner/fixture',
    version: 1,
    archiveBytes: bytes.byteLength,
    archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    licenseId: 'CC0-1.0',
    licenseName: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    redistribution: true,
    categories: ['digits'],
    group: 'fixture-v1',
    limitations: ['Test fixture only.'],
    status: 'verified',
  };
}

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe('public CAPTCHA dataset catalog', () => {
  it('pins unique source versions, licenses, groups, limitations, and verified archive hashes', () => {
    expect(() => validatePublicDatasetCatalog()).not.toThrow();
    expect(PUBLIC_DATASETS.every((dataset) => dataset.status === 'verified')).toBe(true);
  });

  it('rejects archive byte and SHA-256 mismatches', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const dataset = verified(bytes);
    expect(() => verifyPublicDatasetArchive(bytes, dataset)).not.toThrow();
    expect(() => verifyPublicDatasetArchive(new Uint8Array([1, 2]), dataset)).toThrow(/bytes/i);
    expect(() => verifyPublicDatasetArchive(new Uint8Array([1, 2, 4]), dataset)).toThrow(/SHA-256/i);
  });

  it('downloads a verified archive atomically and reuses a verified local copy', async () => {
    const root = await temporaryRoot();
    const bytes = new Uint8Array([80, 75, 3, 4]);
    const dataset = verified(bytes);
    const fetchImpl = vi.fn(async () => new Response(bytes, { status: 200 }));

    await expect(fetchPublicDataset(root, dataset.id, fetchImpl, [dataset])).resolves.toMatchObject({ downloaded: true });
    await expect(fetchPublicDataset(root, dataset.id, fetchImpl, [dataset])).resolves.toMatchObject({ downloaded: false });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new Uint8Array(await readFile(publicDatasetArchivePath(root, dataset)))).toEqual(bytes);
  });

  it('fails closed for a candidate source before attempting a network request', async () => {
    const bytes = new Uint8Array([1]);
    const base = verified(bytes);
    const candidate: CandidatePublicDataset = {
      id: base.id,
      title: base.title,
      pageUrl: base.pageUrl,
      kaggleRef: base.kaggleRef,
      version: base.version,
      archiveBytes: base.archiveBytes,
      licenseId: base.licenseId,
      licenseName: base.licenseName,
      licenseUrl: base.licenseUrl,
      redistribution: base.redistribution,
      categories: base.categories,
      group: base.group,
      limitations: base.limitations,
      status: 'candidate',
      reviewBlocker: 'not audited',
    };
    const fetchImpl = vi.fn();
    await expect(fetchPublicDataset('/project', candidate.id, fetchImpl, [candidate])).rejects.toThrow(/not approved/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
