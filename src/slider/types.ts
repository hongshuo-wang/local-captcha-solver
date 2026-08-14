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

export interface SliderRunResult {
  state: SliderResultState;
  confidence?: number;
  reason?: string;
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
