import { parseArithmetic } from './arithmetic';
import type {
  InterpretedResult,
  OcrResult,
  RecognitionMode,
  ResultInterpreter,
} from './types';

const PLAIN_PATTERNS: Record<Exclude<RecognitionMode, 'arithmetic'>, RegExp> = {
  digits: /^[0-9]+$/,
  letters: /^[A-Za-z]+$/,
  alphanumeric: /^[A-Za-z0-9]+$/,
};

const DIVISION_PATTERN = /^\s*([0-9]+)\s*[\/÷]\s*([0-9]+)\s*(?:[=?]\s*)?$/;

function isNonIntegerDivision(source: string): boolean {
  const match = DIVISION_PATTERN.exec(source);
  if (!match) {
    return false;
  }

  const dividend = BigInt(match[1]);
  const divisor = BigInt(match[2]);
  return divisor !== 0n && dividend % divisor !== 0n;
}

export function interpretResult(result: OcrResult): InterpretedResult {
  if (result.text.trim() === '') {
    return { kind: 'invalid', reason: 'empty' };
  }

  if (result.mode === 'arithmetic') {
    const arithmetic = parseArithmetic(result.text);
    if (arithmetic) {
      return {
        kind: 'arithmetic',
        displayText: `${arithmetic.expression} = ${arithmetic.value}`,
        fillValue: arithmetic.value,
        confidence: result.confidence,
      };
    }

    return {
      kind: 'invalid',
      reason: isNonIntegerDivision(result.text) ? 'non_integer_division' : 'unsupported',
    };
  }

  if (!PLAIN_PATTERNS[result.mode].test(result.text)) {
    return { kind: 'invalid', reason: 'unsupported' };
  }

  return {
    kind: 'plain',
    displayText: result.text,
    fillValue: result.text,
    confidence: result.confidence,
  };
}

export const resultInterpreter: ResultInterpreter = {
  interpret(results) {
    return results.map(interpretResult);
  },
};
