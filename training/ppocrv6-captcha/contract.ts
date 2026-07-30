import { parse } from 'yaml';

export interface TrainingContract {
  readonly visibleCharacters: readonly string[];
  readonly ctcClassCount: number;
  readonly modelName: string;
  readonly backboneName: string;
  readonly backboneSize: string;
  readonly headName: string;
  readonly useSpaceCharacter: boolean;
  readonly maxTextLength: number;
  readonly seed: number;
  readonly trainLabels: readonly string[];
  readonly validationLabels: readonly string[];
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function strings(value: unknown, context: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new TypeError(`${context} must be a string array`);
  }
  return value as string[];
}

export function validateTrainingContract(configText: string, charsetText: string): TrainingContract {
  const lines = charsetText.replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (lines.some((character) => character.length !== 1 || character === ' ')) {
    throw new TypeError('Charset entries must be one visible non-space character');
  }
  if (new Set(lines).size !== lines.length) throw new TypeError('Charset contains duplicate entries');
  const expected = Array.from(new Set(
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+-*/xX×÷=?',
  ));
  if (lines.length !== 70 || lines.join('') !== expected.join('')) {
    throw new TypeError('Charset must contain the exact ordered 70-character CAPTCHA alphabet');
  }

  const config = object(parse(configText), 'training config');
  const global = object(config.Global, 'Global');
  const architecture = object(config.Architecture, 'Architecture');
  const backbone = object(architecture.Backbone, 'Architecture.Backbone');
  const head = object(architecture.Head, 'Architecture.Head');
  const trainDataset = object(object(config.Train, 'Train').dataset, 'Train.dataset');
  const evalDataset = object(object(config.Eval, 'Eval').dataset, 'Eval.dataset');
  if (global.use_space_char !== false) throw new TypeError('use_space_char must be false for 71 CTC classes');
  if (global.character_dict_path !== './training/ppocrv6-captcha/charset.txt') {
    throw new TypeError('character_dict_path must reference the fixed CAPTCHA charset');
  }
  return {
    visibleCharacters: lines,
    ctcClassCount: lines.length + 1,
    modelName: String(global.model_name),
    backboneName: String(backbone.name),
    backboneSize: String(backbone.model_size),
    headName: String(head.name),
    useSpaceCharacter: global.use_space_char,
    maxTextLength: Number(global.max_text_length),
    seed: Number(global.seed),
    trainLabels: strings(trainDataset.label_file_list, 'Train label_file_list'),
    validationLabels: strings(evalDataset.label_file_list, 'Eval label_file_list'),
  };
}
