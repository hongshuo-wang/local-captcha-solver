export interface InstallExperienceRuntime {
  onInstalled: {
    addListener(listener: (details: { reason: string; previousVersion?: string }) => void): void;
  };
  getURL(path: string): string;
}

export interface InstallExperienceTabs {
  create(details: { url: string }): Promise<unknown>;
}

function versionParts(value: string): [number, number, number] | undefined {
  const match = /^([0-9]+)\.([0-9]+)\.([0-9]+)(?:[-+].*)?$/.exec(value);
  if (match === null) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isOlderThan(left: string, right: string): boolean {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  if (leftParts === undefined || rightParts === undefined) return false;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] < rightParts[index];
  }
  return false;
}

export function registerInstallExperience(runtime: InstallExperienceRuntime, tabs: InstallExperienceTabs, currentVersion: string, reportError: (error: unknown) => void = console.error): void {
  runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
      void tabs.create({ url: runtime.getURL('onboarding.html?flow=welcome') }).catch(reportError);
      return;
    }
    if (details.reason === 'update' && details.previousVersion !== undefined && isOlderThan(details.previousVersion, '1.2.0') && !isOlderThan(currentVersion, '1.2.0')) {
      void tabs.create({ url: runtime.getURL(`onboarding.html?flow=upgrade&version=${encodeURIComponent(currentVersion)}`) }).catch(reportError);
    }
  });
}
