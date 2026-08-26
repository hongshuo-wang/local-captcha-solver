export const SLIDER_RESULT_STATES = [
  'success',
  'not-found',
  'unsupported',
  'low-confidence',
  'permission-denied',
  'page-inactive',
  'user-active',
  'failed',
  'uncertain',
] as const;

export type SliderResultState = typeof SLIDER_RESULT_STATES[number];

export type SliderProvider = 'geetest' | 'geetest-v4' | 'generic';

export type SliderImageSource = 'paired-background' | 'background' | 'viewport';
export type SliderLocalizationMethod = 'reference-difference' | 'texture' | 'shape' | 'geometry' | 'edge-perimeter';
export type SliderDiagnosticPhase = 'discovery' | 'activation' | 'localization' | 'execution' | 'outcome';

export interface SliderRunDiagnostic {
  readonly provider?: SliderProvider;
  readonly attemptId?: string;
  readonly challengeId?: string;
  readonly phase?: SliderDiagnosticPhase;
  readonly imageSource?: SliderImageSource;
  readonly localizationMethod?: SliderLocalizationMethod;
  readonly localizationScore?: number;
  readonly confidenceThreshold?: number;
  readonly alternativeImageSource?: SliderImageSource;
  readonly alternativeConfidence?: number;
  readonly gapX?: number;
  readonly gapY?: number;
  readonly pieceOffsetX?: number;
  readonly pieceOffsetY?: number;
  readonly desiredPieceOffsetX?: number;
  readonly actualPieceOffsetX?: number;
  readonly pieceErrorX?: number;
  readonly correctionX?: number;
  readonly imageWidth?: number;
  readonly imageHeight?: number;
  readonly trackWidth?: number;
  readonly handleWidth?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly startX?: number;
  readonly requestedEndX?: number;
  readonly endX?: number;
  readonly releaseX?: number;
  readonly plannedDragX?: number;
  readonly finalDragX?: number;
  readonly outcomeSequence?: string;
}

export interface SliderRunResult {
  state: SliderResultState;
  confidence?: number;
  reason?: string;
  challengeRevision?: string;
  diagnostic?: SliderRunDiagnostic;
}

export interface SliderActivity {
  state: 'running' | SliderResultState;
  trigger: 'manual' | 'automatic';
  at: number;
  confidence?: number;
  reason?: string;
}

export interface SliderSiteState {
  supported: boolean;
  enabled: boolean;
  debuggerGranted: boolean;
  hostname?: string;
  activity?: SliderActivity;
}

export interface SliderSolver {
  solve(tab: { id: number; url: string; windowId?: number }, trigger: 'manual' | 'automatic', expectedRevision?: string): Promise<SliderRunResult>;
  cancel?(tabId: number): void;
}
