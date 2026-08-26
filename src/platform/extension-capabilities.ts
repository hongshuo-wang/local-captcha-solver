export interface ExtensionManifestCapabilities {
  readonly permissions?: readonly string[];
}

export function supportsPuzzleSliders(manifest: ExtensionManifestCapabilities): boolean {
  return manifest.permissions?.includes('debugger') === true;
}
