import assert from "node:assert/strict";
import test from "node:test";

import {
  buildImageSource,
  isDashboardMediaUri,
  shouldAttachDashboardCookie,
} from "./media-policy.ts";

const cookie = "hermes_session_at=secret";
const dashboard = "http://192.168.1.8:9119";

test("attaches the session cookie to same-origin dashboard media paths", () => {
  for (const path of [
    "/api/media?path=%2Ftmp%2Fimage.png",
    "/api/files/read?path=%2Ftmp%2Fimage.png",
    "/static/image.png",
    "/assets/image.png",
    "/files/image.png",
  ]) {
    const uri = `${dashboard}${path}`;
    assert.equal(isDashboardMediaUri(uri, dashboard), true, uri);
    assert.equal(shouldAttachDashboardCookie(uri, dashboard), true, uri);
    assert.deepEqual(buildImageSource(uri, dashboard, cookie), {
      uri,
      headers: { Cookie: cookie },
    });
  }
});

test("supports a dashboard mounted below a reverse-proxy path prefix", () => {
  const base = "https://example.test/hermes";
  const uri = "https://example.test/hermes/api/media?path=%2Ftmp%2Fimage.png";
  assert.equal(isDashboardMediaUri(uri, base), true);
  assert.deepEqual(buildImageSource(uri, base, cookie), {
    uri,
    headers: { Cookie: cookie },
  });

  assert.equal(
    isDashboardMediaUri("https://example.test/other/api/media?path=x", base),
    false,
  );
  assert.equal(
    isDashboardMediaUri("https://example.test/hermes2/api/media?path=x", base),
    false,
  );
});

test("does not attach the cookie to a different origin, port, or scheme", () => {
  const cases = [
    ["https://other.test/api/media?path=x", dashboard],
    ["http://192.168.1.8:9443/api/media?path=x", dashboard],
    ["https://192.168.1.8:9119/api/media?path=x", dashboard],
    ["http://192.168.1.8.evil.test:9119/api/media?path=x", dashboard],
  ];
  for (const [uri, base] of cases) {
    assert.equal(isDashboardMediaUri(uri, base), false, uri);
    assert.deepEqual(buildImageSource(uri, base, cookie), { uri });
  }
});

test("does not attach the cookie to external images or local object URLs", () => {
  const cases = [
    "https://images.example.test/cat.png",
    "http://images.example.test/cat.png",
    "data:image/png;base64,AAAA",
    "blob:https://app.test/asset-id",
    "file:///tmp/image.png",
  ];
  for (const uri of cases) {
    assert.equal(isDashboardMediaUri(uri, dashboard), false, uri);
    assert.deepEqual(buildImageSource(uri, dashboard, cookie), { uri });
  }
});

test("does not attach an empty cookie even for a dashboard URL", () => {
  const uri = `${dashboard}/api/media?path=x`;
  assert.deepEqual(buildImageSource(uri, dashboard, ""), { uri });
});

test("rejects URL userinfo instead of treating it as the dashboard", () => {
  const uri = "http://user:pass@192.168.1.8:9119/api/media?path=x";
  assert.equal(isDashboardMediaUri(uri, dashboard), false);
  assert.deepEqual(buildImageSource(uri, dashboard, cookie), { uri });
});
