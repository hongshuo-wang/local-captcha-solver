export type RecognitionMode = 'digits' | 'letters' | 'alphanumeric' | 'arithmetic';

export interface OcrResult {
  text: string;
  confidence: number;
  mode: RecognitionMode;
}

export interface ImagePayload {
  bytes: Uint8Array;
  mimeType: string;
  revision: string;
}

export interface ImageSource {
  acquire(candidateId: string): Promise<ImagePayload>;
}

export interface ModelInput {
  data: Float32Array;
  dims: readonly [1, 1, 64, number];
}

export interface ImagePreprocessor {
  prepare(image: ImagePayload): Promise<ModelInput>;
}

export interface OcrEngine {
  recognize(image: ImagePayload, modes: readonly RecognitionMode[]): Promise<OcrResult[]>;
}

export type InterpretedResult =
  | { kind: 'plain'; displayText: string; fillValue: string; confidence: number }
  | { kind: 'arithmetic'; displayText: string; fillValue: string; confidence: number }
  | { kind: 'invalid'; reason: 'empty' | 'unsupported' }
  | {
      kind: 'invalid';
      reason: 'non_integer_division';
      displayText: string;
      confidence: number;
    };

export interface ResultInterpreter {
  interpret(results: readonly OcrResult[]): readonly InterpretedResult[];
}

export interface ScoreResult {
  score: number;
  reasons: readonly string[];
}

export interface CaptchaCandidateScorer<TCandidate> {
  score(candidate: TCandidate): ScoreResult;
}

export type FieldMatch<TField> =
  | {
      state: 'unique';
      winner: TField;
      candidates: readonly {
        field: TField;
        score: number;
        reasons: readonly string[];
      }[];
    }
  | {
      state: 'ambiguous';
      winner?: never;
      candidates: readonly {
        field: TField;
        score: number;
        reasons: readonly string[];
      }[];
    }
  | {
      state: 'none';
      winner?: never;
      candidates: readonly {
        field: TField;
        score: number;
        reasons: readonly string[];
      }[];
    };

export interface FieldMatcher<TImage, TField> {
  match(image: TImage, fields: readonly TField[], allowReplacement: boolean): FieldMatch<TField>;
}

export type WorkflowResult =
  | { state: 'filled'; candidateId: string; fieldId: string; displayText: string; fillValue: string }
  | {
      state: 'needs_confirmation';
      candidateId: string;
      displayText: string;
      fillValue?: string;
      fieldIds: readonly string[];
    }
  | { state: 'no_candidate' }
  | { state: 'no_field'; candidateId: string; displayText: string; fillValue: string }
  | { state: 'image_unavailable'; candidateId: string }
  | { state: 'recognition_failed'; candidateId: string }
  | { state: 'stale'; candidateId: string }
  | { state: 'model_unavailable'; candidateId: string };
