import { createHash } from 'node:crypto';

import AdmZip from 'adm-zip';
import { describe, expect, it } from 'vitest';

import { readMathCaptcha10kArchive } from '../../training/ppocrv6-captcha/import-mathcaptcha10k';
import type { VerifiedPublicDataset } from '../../training/ppocrv6-captcha/public-datasets';

function fixture(label = '7+3=?', result = '10') {
  const zip = new AdmZip();
  const filename = '0123456789abcdef0123456789abcdef.png';
  const image = Buffer.from([137, 80, 78, 71]);
  zip.addFile(`Captcha_Images/${filename}`, image);
  zip.addFile('Unlabeled/ignored.png', Buffer.from([1]));
  zip.addFile('mathcaptcha10k.csv', Buffer.from(`filename,ocr_text,result\n${filename},${label},${result}\n`));
  const bytes = zip.toBuffer();
  const dataset: VerifiedPublicDataset = {
    id: 'mathcaptcha10k-v6',
    title: 'fixture',
    pageUrl: 'https://example.test',
    kaggleRef: 'owner/fixture',
    version: 1,
    archiveBytes: bytes.length,
    archiveSha256: createHash('sha256').update(bytes).digest('hex'),
    licenseId: 'CC-BY-4.0',
    licenseName: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    redistribution: true,
    categories: ['arithmetic'],
    group: 'public-kaggle-mathcaptcha10k-v6',
    limitations: ['fixture'],
    status: 'verified',
  };
  return { bytes, dataset, image };
}

describe('MathCaptcha10k importer', () => {
  it('imports only CSV-labeled images with stable metadata and verified arithmetic', () => {
    const { bytes, dataset, image } = fixture();
    expect(readMathCaptcha10kArchive(bytes, dataset, 1)).toEqual([{
      bytes: image,
      manifest: {
        id: 'public-mathcaptcha10k-v6-0123456789abcdef0123456789abcdef',
        split: 'train',
        source: 'public',
        group: dataset.group,
        image: 'data/images/public/mathcaptcha10k-v6/0123456789abcdef0123456789abcdef.png',
        label: '7+3=?',
        sha256: createHash('sha256').update(image).digest('hex'),
        licenseId: 'CC-BY-4.0',
      },
    }]);
  });

  it('rejects incorrect results and unsupported labels', () => {
    const incorrect = fixture('7+3=?', '11');
    expect(() => readMathCaptcha10kArchive(incorrect.bytes, incorrect.dataset, 1)).toThrow(/result/i);
    const unsupported = fixture('7*3=?', '21');
    expect(() => readMathCaptcha10kArchive(unsupported.bytes, unsupported.dataset, 1)).toThrow(/label/i);
  });
});
