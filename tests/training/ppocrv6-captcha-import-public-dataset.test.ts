import { createHash } from 'node:crypto';

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import {
  readDaniilnxyMathArchive,
  readHuthayfahodebArchive,
  readParsasamArchive,
} from '../../training/ppocrv6-captcha/import-public-dataset';
import type { VerifiedPublicDataset } from '../../training/ppocrv6-captcha/public-datasets';

function dataset(id: string, bytes: Buffer): VerifiedPublicDataset {
  return {
    id,
    title: 'fixture',
    pageUrl: 'https://example.test',
    kaggleRef: 'owner/fixture',
    version: 1,
    archiveBytes: bytes.length,
    archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    licenseId: 'CC0-1.0',
    licenseName: 'CC0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
    redistribution: true,
    categories: ['alphanumeric'],
    group: `public-${id}`,
    limitations: ['fixture'],
    status: 'verified',
  };
}

describe('audited public CAPTCHA importers', () => {
  it('derives parsasam labels from exact five-character JPEG filenames', () => {
    const zip = new AdmZip();
    const image = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    zip.addFile('A1b2C.jpg', image);
    const bytes = zip.toBuffer();
    const source = dataset('parsasam-captcha-v1', bytes);
    expect(readParsasamArchive(bytes, source, 1)[0]).toMatchObject({
      manifest: { label: 'A1b2C', split: 'train', group: source.group },
      bytes: image,
    });
  });

  it('merges upstream digit splits into one isolated training group', () => {
    const zip = new AdmZip();
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    zip.addFile('test-images/test-images/image_test_1.png', image);
    zip.addFile('captcha_data.csv', Buffer.from('image_path,solution\ntest-images/image_test_1.png,001234\n'));
    const bytes = zip.toBuffer();
    const source = dataset('huthayfahodeb-captcha-v2', bytes);
    expect(readHuthayfahodebArchive(bytes, source, 1)[0]).toMatchObject({
      manifest: { label: '001234', split: 'train', group: source.group },
      bytes: image,
    });
  });

  it('imports valid arithmetic expressions and excludes negative-result subtraction', () => {
    const zip = new AdmZip();
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    zip.addFile('math_problems_captcha_dt/2+3.png', image);
    zip.addFile('math_problems_captcha_dt/8-5.png', Buffer.concat([image, Buffer.from([1])]));
    zip.addFile('math_problems_captcha_dt/1-4.png', Buffer.concat([image, Buffer.from([2])]));
    zip.addFile(
      'math_problem_captcha_datt.csv',
      Buffer.from('image,label\n2+3.png,5\n8-5.png,3\n1-4.png,-3\n'),
    );
    const bytes = zip.toBuffer();
    const source = dataset('daniilnxy-math-problem-captcha-v1', bytes);
    expect(readDaniilnxyMathArchive(bytes, source, 3, 2).map((sample) => sample.manifest)).toMatchObject([
      { label: '2+3', split: 'train', group: source.group },
      { label: '8-5', split: 'train', group: source.group },
    ]);
  });

  it('rejects incorrect arithmetic results', () => {
    const zip = new AdmZip();
    zip.addFile('math_problems_captcha_dt/2+3.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    zip.addFile('math_problem_captcha_datt.csv', Buffer.from('image,label\n2+3.png,6\n'));
    const bytes = zip.toBuffer();
    const source = dataset('daniilnxy-math-problem-captcha-v1', bytes);
    expect(() => readDaniilnxyMathArchive(bytes, source, 1, 1)).toThrow(/incorrect/i);
  });
});
