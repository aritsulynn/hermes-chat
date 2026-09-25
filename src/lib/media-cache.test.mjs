import assert from "node:assert/strict";
import test from "node:test";

import {
  clearMediaCaches,
  getMediaCacheGeneration,
  mediaCacheKey,
  ratioCache,
  serverFileCache,
} from "./media-cache.ts";

test("cache keys isolate authenticated scopes", () => {
  assert.notEqual(
    mediaCacheKey("host|user-a|default|cookie-a", "/tmp/image.png"),
    mediaCacheKey("host|user-b|default|cookie-b", "/tmp/image.png"),
  );
});

test("clearing media caches removes decoded data and ratios", () => {
  const before = getMediaCacheGeneration();
  serverFileCache.set("scope", "data:image/png;base64,AAAA");
  ratioCache.set("scope", 1.5);
  clearMediaCaches();
  assert.equal(serverFileCache.size, 0);
  assert.equal(ratioCache.size, 0);
  assert.equal(getMediaCacheGeneration(), before + 1);
});
