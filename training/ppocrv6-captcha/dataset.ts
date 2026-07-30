export interface DatasetValidationOptions {
  readonly alphabet: readonly string[];
  readonly maximumLabelLength: number;
  readonly frozenBenchmarkHashes: ReadonlySet<string>;
}

export interface DatasetValidationResult {
  readonly counts: { readonly train: number; readonly validation: number; readonly test: number };
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function nonempty(value: unknown, context: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${context} must be a nonempty string`);
  }
  return value;
}

export function validateDatasetManifest(
  value: unknown,
  options: DatasetValidationOptions,
): DatasetValidationResult {
  const manifest = object(value, 'dataset manifest');
  if (manifest.schemaVersion !== 1) throw new TypeError('Dataset schemaVersion must be 1');
  if (!Array.isArray(manifest.licenses) || !Array.isArray(manifest.samples)) {
    throw new TypeError('Dataset manifest must contain licenses and samples arrays');
  }
  const licenseIds = new Set<string>();
  for (const entry of manifest.licenses) {
    const license = object(entry, 'license');
    const id = nonempty(license.id, 'license id');
    nonempty(license.name, 'license name');
    if (license.url !== null && (typeof license.url !== 'string' || !license.url.startsWith('https://'))) {
      throw new TypeError('License URL must be null or HTTPS');
    }
    if (typeof license.redistribution !== 'boolean') {
      throw new TypeError('License redistribution must be boolean');
    }
    if (licenseIds.has(id)) throw new TypeError(`Duplicate license id: ${id}`);
    licenseIds.add(id);
  }

  const alphabet = new Set(options.alphabet);
  const ids = new Set<string>();
  const hashes = new Set<string>();
  const groupSplits = new Map<string, string>();
  const counts = { train: 0, validation: 0, test: 0 };
  for (const entry of manifest.samples) {
    const sample = object(entry, 'dataset sample');
    const id = nonempty(sample.id, 'sample id');
    const split = nonempty(sample.split, 'sample split');
    const source = nonempty(sample.source, 'sample source');
    const group = nonempty(sample.group, 'sample group');
    const image = nonempty(sample.image, 'sample image');
    const label = nonempty(sample.label, 'sample label');
    const sha256 = nonempty(sample.sha256, 'sample sha256');
    const licenseId = nonempty(sample.licenseId, 'sample licenseId');
    if (!['train', 'validation', 'test'].includes(split)) throw new TypeError(`Invalid split: ${split}`);
    if (!['synthetic', 'public', 'real'].includes(source)) throw new TypeError(`Invalid source: ${source}`);
    if (!/^data\/[A-Za-z0-9_./-]+\.(png|jpg|jpeg|webp)$/.test(image) || image.includes('..')) {
      throw new TypeError(`Invalid dataset image path: ${image}`);
    }
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new TypeError('Sample sha256 must be lowercase hexadecimal');
    const characters = Array.from(label);
    if (characters.length > options.maximumLabelLength || characters.some((character) => !alphabet.has(character))) {
      throw new TypeError(`Sample label contains an unsupported character or exceeds maximum length: ${id}`);
    }
    if (!licenseIds.has(licenseId)) throw new TypeError(`Sample references unknown license: ${licenseId}`);
    if (ids.has(id)) throw new TypeError(`Duplicate sample id: ${id}`);
    if (hashes.has(sha256)) throw new TypeError(`Duplicate sample sha256: ${sha256}`);
    if (options.frozenBenchmarkHashes.has(sha256)) {
      throw new TypeError(`Sample leaks a frozen benchmark image: ${sha256}`);
    }
    const previousSplit = groupSplits.get(group);
    if (previousSplit !== undefined && previousSplit !== split) {
      throw new TypeError(`Dataset group crosses split boundary: ${group}`);
    }
    ids.add(id);
    hashes.add(sha256);
    groupSplits.set(group, split);
    counts[split as keyof typeof counts] += 1;
  }
  return { counts };
}
