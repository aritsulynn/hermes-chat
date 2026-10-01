// Reports JSX elements that are directly nested inside another JSX element of
// the same name. Not part of the app.
//
// The reason this exists: React Native's `<Text>` is inline, so a nested
// `<Text>` continues the same line. Our ui/Text renders a `<div>`, so the same
// nesting breaks the run onto separate lines. It is invisible to the typecheck
// and it is easy to miss by eye in a 1,800-line screen.
//
// Written against the TypeScript parser rather than a tag scanner on purpose. A
// scanner has to guess the parent from a stack, and a stack drifts the moment
// JSX has a fragment, a conditional or a self-closing sibling — which is most of
// this codebase. An earlier version of this check reported 476 nested-text
// sites; reading them showed every one was a sibling, and the parser found a
// single genuine case. Trusting the scanner would have meant 45 wrong edits.
//
// Output is noisy by design — `<div>` inside `<div>` is normal and is most of
// what it prints. What matters is the Text-like names, which render block
// elements and therefore cannot nest.
//
// Usage: node --experimental-strip-types scripts/jsx-nesting.mts <file> [...]
import ts from 'typescript';
import { readFileSync } from 'node:fs';

let total = 0;
for (const file of process.argv.slice(2)) {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const hits = [];

  const walkChildren = (node, parentName) => {
    node.forEachChild((child) => {
      if (ts.isJsxElement(child)) {
        const name = child.openingElement.tagName.getText(sf);
        if (name === parentName) {
          const line = sf.getLineAndCharacterOfPosition(child.getStart(sf)).line + 1;
          hits.push(`  line ${line}: <${name}> inside <${parentName}>`);
          total++;
        }
        // A nested element's own children are still worth walking, one level in.
        walkChildren(child, name);
        return;
      }
      if (ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) return;
      if (ts.isJsxExpression(child) && child.expression) {
        const inner = [];
        const collect = (n) => {
          if (ts.isJsxElement(n)) inner.push(n);
          ts.forEachChild(n, collect);
        };
        ts.forEachChild(child.expression, collect);
        for (const el of inner) {
          const name = el.openingElement.tagName.getText(sf);
          if (name === parentName) {
            const line = sf.getLineAndCharacterOfPosition(el.getStart(sf)).line + 1;
            hits.push(`  line ${line}: <${name}> inside <${parentName}>`);
            total++;
          }
          walkChildren(el, name);
        }
        return;
      }
      walkChildren(child, parentName);
    });
  };

  ts.forEachChild(sf, (n) => {
    if (ts.isJsxElement(n)) {
      const name = n.openingElement.tagName.getText(sf);
      walkChildren(n, name);
    } else {
      walkChildren(n, null);
    }
  });

  if (hits.length) {
    console.log(file);
    for (const h of hits) console.log(h);
  }
}
console.log(total === 0 ? 'no same-name JSX nesting anywhere' : `total: ${total}`);
