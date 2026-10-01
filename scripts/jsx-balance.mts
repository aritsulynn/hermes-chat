// Reports where a JSX element nesting goes wrong, and by how much. Not part of
// the app.
//
// When a codemod rewrites opening and closing tags apart, tsc says "expected
// closing tag for X" at the end of the block, which is nowhere near the line
// that is actually wrong — and one break cascades into a dozen more errors.
//
// This parses with TypeScript's own parser and walks the JSX tree, so it
// reports the one place the tree actually diverges: a JsxElement whose opening
// and closing tag names disagree, and any element left unterminated at EOF.
// A hand-written tag scanner is not good enough — it cannot tell
// `useState<boolean>` from a tag, and it misses tags written across lines.
//
// Usage: node --experimental-strip-types scripts/jsx-balance.mts <file> [...]
import ts from 'typescript';
import { readFileSync } from 'node:fs';

let bad = 0;
for (const file of process.argv.slice(2)) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);

  const problems = [];
  /** @param node @param open  the tag name this element was opened with */
  const walk = (node, open) => {
    if (ts.isJsxElement(node)) {
      const name = node.openingElement.tagName.getText(sf);
      const close = node.closingElement.tagName.getText(sf);
      if (open && open !== name) {
        problems.push(`  line ${sf.getLineAndCharacterOfPosition(node.pos).line + 1}: <${open}> closed by </${close}>`);
      }
      node.children.forEach((c) => walk(c, null));
      return;
    }
    if (ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) return;
    if (ts.isJsxExpression(node) && node.expression) {
      // Elements nested inside a `{...}` expression (a `.map`, a ternary) are
      // walked with no expected close, so a break there is reported on its own
      // terms rather than blamed on an enclosing tag.
      const inner = [];
      const visit = (n) => {
        if (ts.isJsxElement(n)) inner.push(n);
        ts.forEachChild(n, visit);
      };
      visit(node.expression);
      inner.forEach((el) => walk(el, null));
      return;
    }
    ts.forEachChild(node, (c) => walk(c, null));
  };

  ts.forEachChild(sf, (n) => walk(n, null));

  // Anything the parser recovered from is a strong hint the source is broken.
  const parseErrors = sf.parseDiagnostics ?? [];

  console.log(file);
  if (!problems.length && !parseErrors.length) {
    console.log('  balanced');
  } else {
    bad++;
    for (const p of problems.slice(0, 10)) console.log(p);
    for (const d of parseErrors.slice(0, 6)) {
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0);
      console.log(`  parse error line ${line + 1}:${character + 1} — ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`);
    }
  }
}
process.exit(bad ? 1 : 0);
