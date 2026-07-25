export interface BrowserAdapter {
  getLocal<T>(key: string): Promise<T | undefined>;
  setLocal<T>(key: string, value: T): Promise<void>;
  requestOrigins(origins: readonly string[]): Promise<boolean>;
  removeOrigins(origins: readonly string[]): Promise<boolean>;
}
