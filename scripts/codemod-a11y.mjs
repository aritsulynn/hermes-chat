// Codemod pass 3: repairs pass 1's `aria-state` and finishes the Pressable →
// <button> conversion. Not part of the app.
//
// `aria-state={{selected: x}}` is not an attribute. The DOM has no generic
// "state" attribute, so each key has to become the specific one it stands for:
//   selected  -> aria-pressed   (a toggle button)
//   checked   -> aria-checked   (a checkbox)
//   expanded  -> aria-expanded  (a disclosure)
//   disabled  -> the native `disabled`
// A row that set two of them keeps only the one that describes the control, and
// that is decided here by which key appears first.
//
// Run after codemod-ui.mjs: node scripts/codemod-a11y.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(`grep -rl "aria-state=\\|<Pressable" src --include='*.tsx' || true`)
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);

const KEY_TO_ATTR = { selected: 'aria-pressed', checked: 'aria-checked', expanded: 'aria-expanded' };

/**
 * `aria-state={ a: X, b: Y }` — the braces were already eaten by pass 1, so
 * this sees bare `key: value` pairs. Map each to its attribute, then keep the
 * first one; a native control reports the rest itself.
 */
function fixAriaState(line) {
  return line.replace(/aria-state=\{([^}]*)\}/, (_m, inner) => {
    const pairs = [...inner.matchAll(/(\w+):\s*([^,}]+)/g)];
    if (!pairs.length) return '';
    const first = pairs[0];
    const attr = KEY_TO_ATTR[first[1]];
    // An unrecognised key means the shape is not what we expect; leave the line
    // alone rather than guess, so it shows up in the typecheck as an error
    // instead of silently becoming something wrong.
    if (!attr) return `aria-state={${inner}}`;
    const extra = pairs.slice(1).filter(([, k]) => KEY_TO_ATTR[k]);
    if (extra.length) {
      return `${extra.map(([, k, v]) => `${KEY_TO_ATTR[k]}={${v.trim()}}`).join(' ')} ${attr}={${first[2].trim()}}`;
    }
    return `${attr}={${first[2].trim()}}`;
  });
}

let touched = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let s = before;

  s = s
    .split('\n')
    .map(fixAriaState)
    .join('\n');

  // Pressable -> <button type="button">. A real button is the right element
  // here: it gives Enter/Space activation and the disabled semantics for free,
  // which a role="button" div does not.
  s = s.replace(/<Pressable(?=[\s/>])/g, '<button type="button"');
  s = s.replace(/<\/Pressable>/g, '</button>');

  // SafeAreaView's `edges` had no meaning once the wrapper became a div; the
  // padding it applied is `env(safe-area-inset-*)`, set by the screen itself.
  s = s.replace(/\n\s*edges=\{\[[^\]]*\]\}/g, '');

  if (s !== before) {
    writeFileSync(file, s);
    touched++;
  }
}
console.log(`codemod-a11y: rewrote ${touched} file(s)`);
