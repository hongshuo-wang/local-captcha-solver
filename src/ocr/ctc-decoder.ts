function parseDimensions(dims: readonly number[]): { time: number; classes: number } {
  if (!Array.isArray(dims)) {
    throw new TypeError('CTC dimensions must be an array');
  }
  if (dims.length !== 3) {
    throw new RangeError('CTC dimensions must have exactly three axes');
  }

  const [first, second, classes] = dims;
  if (!Number.isInteger(classes) || classes <= 0) {
    throw new RangeError('CTC class dimension must be a positive integer');
  }

  let time: number;
  if (first === 1) {
    time = second;
  } else if (second === 1) {
    time = first;
  } else {
    throw new RangeError('CTC dimensions must be [1, time, classes] or [time, 1, classes]');
  }

  if (!Number.isInteger(time) || time <= 0) {
    throw new RangeError('CTC time dimension must be a positive integer');
  }

  return { time, classes };
}

export function decodeCtc(
  logits: Float32Array,
  dims: readonly number[],
  charset: readonly string[],
  allowed: ReadonlySet<string>,
): { text: string; confidence: number } {
  if (!(logits instanceof Float32Array)) {
    throw new TypeError('CTC logits must be a Float32Array');
  }
  if (!Array.isArray(charset)) {
    throw new TypeError('CTC charset must be an array');
  }
  if (allowed === null || typeof allowed !== 'object' || typeof allowed.has !== 'function') {
    throw new TypeError('CTC allowed characters must be a ReadonlySet');
  }

  const { time, classes } = parseDimensions(dims);
  if (logits.length !== time * classes) {
    throw new RangeError(
      `CTC logits length ${logits.length} does not match time * classes (${time * classes})`,
    );
  }
  if (charset.length !== classes) {
    throw new RangeError(
      `CTC charset length ${charset.length} does not match class count ${classes}`,
    );
  }
  if (charset.some((character) => typeof character !== 'string')) {
    throw new TypeError('CTC charset entries must be strings');
  }
  if (charset[0] !== '') {
    throw new RangeError('CTC charset index 0 must be the blank symbol');
  }

  for (let index = 0; index < logits.length; index += 1) {
    if (!Number.isFinite(logits[index])) {
      throw new RangeError(`CTC logits must be finite; invalid value at index ${index}`);
    }
  }

  const candidates = [0];
  for (let classIndex = 1; classIndex < classes; classIndex += 1) {
    if (allowed.has(charset[classIndex])) {
      candidates.push(classIndex);
    }
  }

  const emitted: string[] = [];
  const confidences: number[] = [];
  let previousClass = 0;

  for (let timestep = 0; timestep < time; timestep += 1) {
    const offset = timestep * classes;
    let selectedClass = candidates[0];
    let selectedLogit = logits[offset + selectedClass];
    let maximumLogit = logits[offset];

    for (let classIndex = 1; classIndex < classes; classIndex += 1) {
      maximumLogit = Math.max(maximumLogit, logits[offset + classIndex]);
    }
    for (let candidateIndex = 1; candidateIndex < candidates.length; candidateIndex += 1) {
      const classIndex = candidates[candidateIndex];
      const candidateLogit = logits[offset + classIndex];
      if (candidateLogit > selectedLogit) {
        selectedClass = classIndex;
        selectedLogit = candidateLogit;
      }
    }

    let denominator = 0;
    for (let classIndex = 0; classIndex < classes; classIndex += 1) {
      denominator += Math.exp(logits[offset + classIndex] - maximumLogit);
    }
    const selectedProbability = Math.exp(selectedLogit - maximumLogit) / denominator;

    if (selectedClass === 0) {
      previousClass = 0;
      continue;
    }

    if (selectedClass === previousClass) {
      const lastIndex = confidences.length - 1;
      confidences[lastIndex] = Math.max(confidences[lastIndex], selectedProbability);
      continue;
    }

    emitted.push(charset[selectedClass]);
    confidences.push(selectedProbability);
    previousClass = selectedClass;
  }

  if (emitted.length === 0) {
    return { text: '', confidence: 0 };
  }

  return {
    text: emitted.join(''),
    confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
  };
}
