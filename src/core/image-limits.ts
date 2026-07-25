/** Maximum decoded image bytes accepted from any source. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Largest base64 payload that represents exactly MAX_IMAGE_BYTES decoded bytes. */
export const MAX_IMAGE_BASE64_BYTES = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

/** Allows a normalized data URL header in addition to the maximum encoded payload. */
export const MAX_IMAGE_DATA_URL_BYTES = MAX_IMAGE_BASE64_BYTES + 128;

/** CAPTCHA images should not require a canvas dimension larger than 2048 pixels. */
export const MAX_CAPTCHA_IMAGE_DIMENSION = 2048;

/** Bounds canvas backing-store allocation even when both dimensions are individually valid. */
export const MAX_CAPTCHA_IMAGE_PIXELS = 2 * 1024 * 1024;
