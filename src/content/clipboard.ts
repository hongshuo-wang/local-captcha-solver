/** Copy text without leaving a temporary DOM node behind. */
export async function copyText(value: string): Promise<boolean> {
  const clipboard = globalThis.navigator?.clipboard;
  if (clipboard?.writeText !== undefined) {
    try {
      await clipboard.writeText(value);
      return true;
    } catch {
      // Fall back to the synchronous page API when permission or activation is unavailable.
    }
  }

  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  Object.assign(field.style, { position: 'fixed', left: '-9999px', top: '0', opacity: '0' });
  document.body.append(field);
  field.select();
  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
  }
}
