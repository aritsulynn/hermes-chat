import assert from "node:assert/strict";
import test from "node:test";

import MarkdownIt from "markdown-it";

test("markdown parser override remains render-compatible", () => {
  const html = new MarkdownIt({ typographer: true }).render(
    "[secure](mailto:a@example.com)",
  );
  assert.match(html, /href="mailto:a@example\.com"/);
});
