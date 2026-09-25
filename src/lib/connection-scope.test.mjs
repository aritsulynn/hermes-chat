import assert from "node:assert/strict";
import test from "node:test";

import {
  connectionScope,
  normalizeConnectionBase,
} from "./connection-scope.ts";

test("normalizes dashboard URL variants without merging query/hash state", () => {
  assert.equal(
    normalizeConnectionBase("HTTP://Example.test:9119/"),
    "http://example.test:9119",
  );
  assert.equal(
    normalizeConnectionBase("https://example.test/hermes/?tab=1#x"),
    "https://example.test/hermes",
  );
});

test("account scopes distinguish origin, path, and username", () => {
  const a = connectionScope("http://example.test:9119", "alice");
  assert.notEqual(a, connectionScope("http://example.test:9119", "bob"));
  assert.notEqual(
    a,
    connectionScope("http://example.test:9119/hermes", "alice"),
  );
  assert.equal(a, connectionScope("http://example.test:9119/", " alice "));
  assert.equal(connectionScope("", ""), "");
  assert.equal(connectionScope("http://user:pass@example.test", "alice"), "");
});
