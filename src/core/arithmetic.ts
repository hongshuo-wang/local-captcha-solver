export interface ArithmeticResult {
  expression: string;
  value: string;
}

const ARITHMETIC_PATTERN = /^\s*([0-9]+)\s*([+\-*/xX×÷])\s*([0-9]+)\s*(?:[=?]\s*)?$/;

export function parseArithmetic(source: string): ArithmeticResult | null {
  const match = ARITHMETIC_PATTERN.exec(source);
  if (!match) {
    return null;
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
      if (right === 0n || left % right !== 0n) {
        return null;
      }
      operator = '/';
      value = left / right;
      break;
    default:
      return null;
  }

  return {
    expression: `${leftDigits}${operator}${rightDigits}`,
    value: value.toString(),
  };
}
