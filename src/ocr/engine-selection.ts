export type LocalOcrEngine = 'ddddocr' | 'ppocrv6-small' | 'captcha-ctc';

export const PPOCRV6_SMALL_BUILD_MODE = 'ppocrv6-small';
export const CAPTCHA_CTC_BUILD_MODE = 'captcha-ctc';

export function ocrEngineForBuildMode(mode: string): LocalOcrEngine {
  return mode === PPOCRV6_SMALL_BUILD_MODE ? 'ppocrv6-small' : 'captcha-ctc';
}

export const ACTIVE_OCR_ENGINE = ocrEngineForBuildMode(import.meta.env?.MODE ?? 'production');
