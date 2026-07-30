export interface ArithmeticResult {
  expression: string;
  value: string;
}

export type ArithmeticAnalysis =
  | ({ kind: 'valid' } & ArithmeticResult)
  | { kind: 'non_integer_division'; expression: string }
  | { kind: 'unsupported' };

export const MAX_OCR_TEXT_LENGTH = 64;

const ARITHMETIC_PATTERN =
  /^\s*([0-9]+)\s*([+\-*/xX×÷])\s*([0-9]+)\s*(?:(?:[=?]|=\?|\?=)\s*)?$/;

export function analyzeArithmetic(source: string): ArithmeticAnalysis {
  if (typeof source !== 'string' || source.length > MAX_OCR_TEXT_LENGTH) {
    return { kind: 'unsupported' };
  }

  const match = ARITHMETIC_PATTERN.exec(source);
  if (!match) {
    return { kind: 'unsupported' };
  }

  const [, leftDigits, sourceOperator, rightDigits] = match;
  const left = BigInt(leftDigits);
  const right = BigInt(rightDigits);
  let operator: '+' | '-' | '*' | '/';
  let value: bigint;

  switch (sourceOperator) {
    case '+':
      operator = '+';
      value = left + right;
      break;
    case '-':
      operator = '-';
      value = left - right;
      break;
    case '*':
    case 'x':
    case 'X':
    case '×':
      operator = '*';
      value = left * right;
      break;
    case '/':
    case '÷':
      operator = '/';
      if (right === 0n) {
        return { kind: 'unsupported' };
      }
      if (left % right !== 0n) {
        return {
          kind: 'non_integer_division',
          expression: `${leftDigits}${operator}${rightDigits}`,
        };
      }
      value = left / right;
      break;
    default:
      return { kind: 'unsupported' };
  }

  return {
    kind: 'valid',
    expression: `${leftDigits}${operator}${rightDigits}`,
    value: value.toString(),
  };
}

export function parseArithmetic(source: string): ArithmeticResult | null {
  const analysis = analyzeArithmetic(source);
  if (analysis.kind !== 'valid') {
    return null;
  }

  return {
    expression: analysis.expression,
    value: analysis.value,
  };
}
