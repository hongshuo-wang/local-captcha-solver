export interface InstallExperienceRuntime {
  onInstalled: {
    addListener(listener: (details: { reason: string }) => void): void;
  };
  getURL(path: string): string;
}

export interface InstallExperienceTabs {
  create(details: { url: string }): Promise<unknown>;
}

export function registerInstallExperience(runtime: InstallExperienceRuntime, tabs: InstallExperienceTabs, reportError: (error: unknown) => void = console.error): void {
  runtime.onInstalled.addListener((details) => {
    if (details.reason !== 'install') return;
    void tabs.create({ url: runtime.getURL('onboarding.html') }).catch(reportError);
  });
}
