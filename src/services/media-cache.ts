export function mediaCacheKey(scope: string, value: string): string {
  return `${scope}\u0000${value}`;
}

export const serverFileCache = new Map<string, string>();
export const serverFilePending = new Map<string, Promise<string>>();
export const ratioCache = new Map<string, number>();
let cacheGeneration = 0;

export function getMediaCacheGeneration(): number {
  return cacheGeneration;
}

/** Drop decoded file data and in-flight work when the authenticated scope ends. */
export function clearMediaCaches(): void {
  cacheGeneration += 1;
  serverFileCache.clear();
  serverFilePending.clear();
  ratioCache.clear();
}
