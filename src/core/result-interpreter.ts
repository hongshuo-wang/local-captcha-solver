import { analyzeArithmetic, MAX_OCR_TEXT_LENGTH } from './arithmetic';
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

export function interpretResult(result: OcrResult): InterpretedResult {
  if (
    typeof result.text !== 'string' ||
    result.text.length > MAX_OCR_TEXT_LENGTH ||
    !Number.isFinite(result.confidence) ||
    result.confidence < 0 ||
    result.confidence > 1
  ) {
    return { kind: 'invalid', reason: 'unsupported' };
  }

  if (result.text.trim() === '') {
    return { kind: 'invalid', reason: 'empty' };
  }

  if (result.mode === 'arithmetic') {
    const analysis = analyzeArithmetic(result.text);
    if (analysis.kind === 'valid') {
      return {
        kind: 'arithmetic',
        displayText: `${analysis.expression} = ${analysis.value}`,
        fillValue: analysis.value,
        confidence: result.confidence,
      };
    }

    if (analysis.kind === 'non_integer_division') {
      return {
        kind: 'invalid',
        reason: 'non_integer_division',
        displayText: analysis.expression,
        confidence: result.confidence,
      };
    }

    return {
      kind: 'invalid',
      reason: 'unsupported',
    };
  }

  const pattern = PLAIN_PATTERNS[result.mode];
  if (!pattern || !pattern.test(result.text)) {
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
