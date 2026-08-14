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

export interface SliderRunDiagnostic {
  readonly provider?: SliderProvider;
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
}

export interface SliderRunResult {
  state: SliderResultState;
  confidence?: number;
  reason?: string;
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
  solve(tab: { id: number; url: string; windowId?: number }, trigger: 'manual' | 'automatic'): Promise<SliderRunResult>;
}
