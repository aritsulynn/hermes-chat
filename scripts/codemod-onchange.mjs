// Codemod pass 5: `onChangeText` -> `onChange` needs the event unwrapped.
//
// Pass 1 renamed the prop but left the handler shape alone, so every
// `onChange={setSomething}` is now a `Dispatch<SetStateAction<string>>` being
// handed a ChangeEvent. The fix is to read `.target.value` at the call site.
//
// The exception is <Field> (components/ui/bits), which this codebase defines to
// take the value directly — that is a component of ours, not a DOM element, so
// its `onChange={setX}` was always correct and must be left alone.
//
// Run after codemod-scroll.mjs: node scripts/codemod-onchange.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(`grep -rl "onChange={" src --include='*.tsx' || true`)
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);

let touched = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const lines = before.split('\n');
  const out = lines.map((line, i) => {
    if (!/onChange=\{[A-Za-z_$][\w$]*\}/.test(line)) return line;
    // Which element is this attribute on? Walk back to the nearest opening tag.
    let tag = '';
    for (let j = i; j >= 0; j--) {
      const m = /<([A-Za-z][\w.]*)\b/.exec(lines[j]);
      if (m) {
        tag = m[1];
        break;
      }
    }
    // Ours, and already value-typed.
    if (tag === 'Field') return line;
    return line.replace(/onChange=\{([A-Za-z_$][\w$]*)\}/, (_m, fn) => `onChange={(e) => ${fn}(e.target.value)}`);
  });
  const s = out.join('\n');
  if (s !== before) {
    writeFileSync(file, s);
    touched++;
  }
}
console.log(`codemod-onchange: rewrote ${touched} file(s)`);
