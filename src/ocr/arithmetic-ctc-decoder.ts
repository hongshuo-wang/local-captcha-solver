import { analyzeArithmetic, MAX_OCR_TEXT_LENGTH } from '../core/arithmetic';

const BEAM_WIDTH = 24;
const OPERATORS = new Set(['+', '-', '*', '/', 'x', 'X', '×', '÷']);
const SUFFIXES = new Set(['=', '?']);
const INFERRED_SUFFIX_MARKERS = new Set(['=', '?', '-']);
const INFERRED_SUFFIX_MARKER_MIN_PROBABILITY = 0.1;
const RELEVANT_CHARACTERS = new Set([
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  ...OPERATORS,
  ...SUFFIXES,
]);
const NEGATIVE_INFINITY = Number.NEGATIVE_INFINITY;

interface BeamState {
  blank: number;
  nonBlank: number;
}

interface RelevantClass {
  character: string;
  classIndex: number;
}

interface RowNormalization {
  maximum: number;
  logShiftedDenominator: number;
}

interface ForcedAlignment {
  confidence: number;
  characterTimesteps: Int16Array;
}

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

function logAdd(left: number, right: number): number {
  if (left === NEGATIVE_INFINITY) {
    return right;
  }
  if (right === NEGATIVE_INFINITY) {
    return left;
  }

  const maximum = Math.max(left, right);
  return maximum + Math.log1p(Math.exp(-Math.abs(left - right)));
}

function beamTotal(state: BeamState): number {
  return logAdd(state.blank, state.nonBlank);
}

function comparePrefixes(
  [leftPrefix, leftState]: readonly [string, BeamState],
  [rightPrefix, rightState]: readonly [string, BeamState],
): number {
  const scoreDifference = beamTotal(rightState) - beamTotal(leftState);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }
  if (leftPrefix < rightPrefix) {
    return -1;
  }
  if (leftPrefix > rightPrefix) {
    return 1;
  }
  return 0;
}

function rowNormalization(
  logits: Float32Array,
  offset: number,
  classes: number,
): RowNormalization {
  let maximum = logits[offset];
  for (let classIndex = 1; classIndex < classes; classIndex += 1) {
    maximum = Math.max(maximum, logits[offset + classIndex]);
  }

  let shiftedDenominator = 0;
  for (let classIndex = 0; classIndex < classes; classIndex += 1) {
    shiftedDenominator += Math.exp(logits[offset + classIndex] - maximum);
  }

  return {
    maximum,
    logShiftedDenominator: Math.log(shiftedDenominator),
  };
}

function logProbability(
  logits: Float32Array,
  offset: number,
  classIndex: number,
  normalization: RowNormalization,
): number {
  return (
    logits[offset + classIndex] - normalization.maximum - normalization.logShiftedDenominator
  );
}

function isDigit(character: string): boolean {
  return character >= '0' && character <= '9';
}

function arithmeticShape(text: string): { prefix: boolean; complete: boolean } {
  if (text.length > MAX_OCR_TEXT_LENGTH) {
    return { prefix: false, complete: false };
  }

  let index = 0;
  while (index < text.length && isDigit(text[index])) {
    index += 1;
  }
  if (index === text.length) {
    return { prefix: true, complete: false };
  }
  if (index === 0 || !OPERATORS.has(text[index])) {
    return { prefix: false, complete: false };
  }

  index += 1;
  const rightStart = index;
  while (index < text.length && isDigit(text[index])) {
    index += 1;
  }
  if (index === text.length) {
    return { prefix: true, complete: index > rightStart };
  }
  const firstSuffix = text[index];
  if (!SUFFIXES.has(firstSuffix)) {
    return { prefix: false, complete: false };
  }
  index += 1;
  if (index === text.length) {
    return { prefix: true, complete: true };
  }
  if (!SUFFIXES.has(text[index]) || text[index] === firstSuffix || index + 1 !== text.length) {
    return { prefix: false, complete: false };
  }

  return { prefix: true, complete: true };
}

function greedyRelevantText(
  logits: Float32Array,
  time: number,
  classes: number,
  relevantClasses: readonly RelevantClass[],
): string {
  const candidates = [{ character: '', classIndex: 0 }, ...relevantClasses];
  const emitted: string[] = [];
  let previousClass = 0;

  for (let timestep = 0; timestep < time; timestep += 1) {
    const offset = timestep * classes;
    let selected = candidates[0];
    for (let candidateIndex = 1; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      if (logits[offset + candidate.classIndex] > logits[offset + selected.classIndex]) {
        selected = candidate;
      }
    }

    if (selected.classIndex === 0) {
      previousClass = 0;
    } else if (selected.classIndex !== previousClass) {
      emitted.push(selected.character);
      previousClass = selected.classIndex;
    }
  }

  return emitted.join('');
}

function hasInExpressionOperatorRun(text: string): boolean {
  for (let index = 1; index < text.length - 1; index += 1) {
    if (!isDigit(text[index - 1]) || !OPERATORS.has(text[index])) {
      continue;
    }

    let rightIndex = index + 1;
    while (rightIndex < text.length && OPERATORS.has(text[rightIndex])) {
      rightIndex += 1;
    }
    if (rightIndex - index >= 2 && rightIndex < text.length && isDigit(text[rightIndex])) {
      return true;
    }

    index = rightIndex - 1;
  }
  return false;
}

function addBeamScore(
  beams: Map<string, BeamState>,
  prefix: string,
  kind: keyof BeamState,
  score: number,
): void {
  if (score === NEGATIVE_INFINITY) {
    return;
  }

  const state = beams.get(prefix) ?? {
    blank: NEGATIVE_INFINITY,
    nonBlank: NEGATIVE_INFINITY,
  };
  state[kind] = logAdd(state[kind], score);
  beams.set(prefix, state);
}

function selectCandidate(
  logits: Float32Array,
  time: number,
  classes: number,
  relevantClasses: readonly RelevantClass[],
): string | null {
  let beams = new Map<string, BeamState>([
    ['', { blank: 0, nonBlank: NEGATIVE_INFINITY }],
  ]);

  for (let timestep = 0; timestep < time; timestep += 1) {
    const offset = timestep * classes;
    const normalization = rowNormalization(logits, offset, classes);
    const blankScore = logProbability(logits, offset, 0, normalization);
    const next = new Map<string, BeamState>();

    for (const [prefix, state] of beams) {
      const total = beamTotal(state);
      addBeamScore(next, prefix, 'blank', total + blankScore);

      for (const relevantClass of relevantClasses) {
        const characterScore = logProbability(
          logits,
          offset,
          relevantClass.classIndex,
          normalization,
        );
        const lastCharacter = prefix[prefix.length - 1];

        if (relevantClass.character === lastCharacter) {
          addBeamScore(next, prefix, 'nonBlank', state.nonBlank + characterScore);

          const extended = prefix + relevantClass.character;
          if (arithmeticShape(extended).prefix) {
            addBeamScore(next, extended, 'nonBlank', state.blank + characterScore);
          }
          continue;
        }

        const extended = prefix + relevantClass.character;
        if (arithmeticShape(extended).prefix) {
          addBeamScore(next, extended, 'nonBlank', total + characterScore);
        }
      }
    }

    beams = new Map([...next.entries()].sort(comparePrefixes).slice(0, BEAM_WIDTH));
  }

  const complete = [...beams.entries()]
    .filter(
      ([prefix]) =>
        arithmeticShape(prefix).complete && analyzeArithmetic(prefix).kind !== 'unsupported',
    )
    .sort(comparePrefixes);
  return complete[0]?.[0] ?? null;
}

function forcedAlignment(
  logits: Float32Array,
  time: number,
  classes: number,
  text: string,
  classByCharacter: ReadonlyMap<string, number>,
): ForcedAlignment | null {
  const targetClasses = [...text].map((character) => classByCharacter.get(character));
  if (targetClasses.some((classIndex) => classIndex === undefined)) {
    return null;
  }

  const resolvedTargetClasses = targetClasses as number[];
  const stateCount = resolvedTargetClasses.length * 2 + 1;
  const backpointers = new Int16Array(time * stateCount);
  backpointers.fill(-1);

  let previous = new Float64Array(stateCount);
  previous.fill(NEGATIVE_INFINITY);
  const firstNormalization = rowNormalization(logits, 0, classes);
  previous[0] = logProbability(logits, 0, 0, firstNormalization);
  previous[1] = logProbability(logits, 0, resolvedTargetClasses[0], firstNormalization);

  for (let timestep = 1; timestep < time; timestep += 1) {
    const offset = timestep * classes;
    const normalization = rowNormalization(logits, offset, classes);
    const current = new Float64Array(stateCount);
    current.fill(NEGATIVE_INFINITY);

    for (let state = 0; state < stateCount; state += 1) {
      let bestPredecessor = state;
      let bestScore = previous[state];

      if (
        state > 0 &&
        (previous[state - 1] > bestScore ||
          (previous[state - 1] === bestScore && state - 1 < bestPredecessor))
      ) {
        bestPredecessor = state - 1;
        bestScore = previous[state - 1];
      }

      const characterPosition = (state - 1) / 2;
      const canSkip =
        state > 1 &&
        state % 2 === 1 &&
        resolvedTargetClasses[characterPosition] !==
          resolvedTargetClasses[characterPosition - 1];
      if (
        canSkip &&
        (previous[state - 2] > bestScore ||
          (previous[state - 2] === bestScore && state - 2 < bestPredecessor))
      ) {
        bestPredecessor = state - 2;
        bestScore = previous[state - 2];
      }

      if (bestScore === NEGATIVE_INFINITY) {
        continue;
      }

      const emittedClass =
        state % 2 === 0 ? 0 : resolvedTargetClasses[(state - 1) / 2];
      current[state] =
        bestScore + logProbability(logits, offset, emittedClass, normalization);
      backpointers[timestep * stateCount + state] = bestPredecessor;
    }

    previous = current;
  }

  const terminalCharacter = stateCount - 2;
  const trailingBlank = stateCount - 1;
  let terminalState = terminalCharacter;
  if (previous[trailingBlank] > previous[terminalCharacter]) {
    terminalState = trailingBlank;
  }
  if (!Number.isFinite(previous[terminalState])) {
    return null;
  }

  const alignedStates = new Int16Array(time);
  let state = terminalState;
  for (let timestep = time - 1; timestep >= 0; timestep -= 1) {
    alignedStates[timestep] = state;
    if (timestep > 0) {
      state = backpointers[timestep * stateCount + state];
      if (state < 0) {
        return null;
      }
    }
  }

  const characterConfidences = Array<number>(resolvedTargetClasses.length).fill(
    NEGATIVE_INFINITY,
  );
  const characterTimesteps = new Int16Array(resolvedTargetClasses.length);
  characterTimesteps.fill(-1);
  for (let timestep = 0; timestep < time; timestep += 1) {
    const alignedState = alignedStates[timestep];
    if (alignedState % 2 === 0) {
      continue;
    }

    const characterPosition = (alignedState - 1) / 2;
    const offset = timestep * classes;
    const normalization = rowNormalization(logits, offset, classes);
    const probability = Math.exp(
      logProbability(
        logits,
        offset,
        resolvedTargetClasses[characterPosition],
        normalization,
      ),
    );
    if (probability > characterConfidences[characterPosition]) {
      characterConfidences[characterPosition] = probability;
      characterTimesteps[characterPosition] = timestep;
    }
  }

  if (characterConfidences.some((confidence) => !Number.isFinite(confidence))) {
    return null;
  }

  return {
    confidence:
      characterConfidences.reduce((sum, confidence) => sum + confidence, 0) /
      characterConfidences.length,
    characterTimesteps,
  };
}

function expressionBeforeInferredSuffix(
  logits: Float32Array,
  classes: number,
  text: string,
  alignment: ForcedAlignment,
  classByCharacter: ReadonlyMap<string, number>,
): string | null {
  const operatorIndex = [...text].findIndex((character) => OPERATORS.has(character));
  if (operatorIndex < 1) {
    return null;
  }

  for (let rightIndex = operatorIndex + 2; rightIndex < text.length; rightIndex += 1) {
    if (!isDigit(text[rightIndex - 1]) || !isDigit(text[rightIndex])) {
      break;
    }

    const previousTimestep = alignment.characterTimesteps[rightIndex - 1];
    const currentTimestep = alignment.characterTimesteps[rightIndex];
    for (let timestep = previousTimestep + 1; timestep < currentTimestep; timestep += 1) {
      const offset = timestep * classes;
      const normalization = rowNormalization(logits, offset, classes);
      let markerProbability = 0;
      for (const marker of INFERRED_SUFFIX_MARKERS) {
        const classIndex = classByCharacter.get(marker);
        if (classIndex === undefined) {
          continue;
        }
        markerProbability = Math.max(
          markerProbability,
          Math.exp(logProbability(logits, offset, classIndex, normalization)),
        );
      }
      if (markerProbability < INFERRED_SUFFIX_MARKER_MIN_PROBABILITY) {
        continue;
      }

      const expression = text.slice(0, rightIndex);
      if (analyzeArithmetic(expression).kind !== 'unsupported') {
        return expression;
      }
    }
  }

  return null;
}

export function decodeArithmeticCtc(
  logits: Float32Array,
  dims: readonly number[],
  charset: readonly string[],
): { text: string; confidence: number; requiresConfirmation?: boolean } | null {
  if (!(logits instanceof Float32Array)) {
    throw new TypeError('CTC logits must be a Float32Array');
  }
  if (!Array.isArray(charset)) {
    throw new TypeError('CTC charset must be an array');
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

  const classByCharacter = new Map<string, number>();
  for (let classIndex = 1; classIndex < classes; classIndex += 1) {
    const character = charset[classIndex];
    if (RELEVANT_CHARACTERS.has(character) && !classByCharacter.has(character)) {
      classByCharacter.set(character, classIndex);
    }
  }
  const relevantClasses = [...classByCharacter.entries()].map(
    ([character, classIndex]): RelevantClass => ({ character, classIndex }),
  );

  if (hasInExpressionOperatorRun(greedyRelevantText(logits, time, classes, relevantClasses))) {
    return null;
  }

  const text = selectCandidate(logits, time, classes, relevantClasses);
  if (text === null) {
    return null;
  }

  let alignment = forcedAlignment(
    logits,
    time,
    classes,
    text,
    classByCharacter,
  );
  if (alignment === null) {
    return null;
  }

  const inferredExpression = expressionBeforeInferredSuffix(
    logits,
    classes,
    text,
    alignment,
    classByCharacter,
  );
  if (inferredExpression !== null) {
    alignment = forcedAlignment(
      logits,
      time,
      classes,
      inferredExpression,
      classByCharacter,
    );
    if (alignment === null) {
      return null;
    }
    return {
      text: inferredExpression,
      confidence: alignment.confidence,
      requiresConfirmation: true,
    };
  }

  return { text, confidence: alignment.confidence };
}
