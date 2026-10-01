// Codemod pass 4: ScrollView/RefreshControl -> ScrollArea, plus the inline
// `edges` prop left on divs. Not part of the app.
//
// `contentContainerStyle={{ padding: 16, gap: 12 }}` has to become Tailwind
// classes, so there is a small style-object translator here. It covers only the
// properties these screens actually use; anything it does not recognise is
// emitted as a comment so it shows up in review rather than being dropped.
//
// `refreshControl` is deleted, not translated. A browser has no pull-to-refresh
// primitive, and every one of these screens already carries a refresh control in
// its header — the gesture was a convenience, not the only path.
//
// Run after codemod-a11y.mjs: node scripts/codemod-scroll.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(`grep -rl "<ScrollView\\|refreshControl=\\|edges={" src --include='*.tsx' || true`)
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);

const SAFE_BOTTOM_PADDING = 'pb-[calc(env(safe-area-inset-bottom,0px)+24px)]';

const NUM = (n) => {
  // React Native unit numbers are density-independent pixels, and Tailwind's
  // spacing scale is 4px per step, so /4 lands on the nearest step.
  // A non-literal (`insets.bottom + 24`) is the one shape the translator cannot
  // express, and it is always bottom padding against the home indicator — which
  // the browser can state directly.
  if (typeof n !== 'number') return { literal: false, cls: SAFE_BOTTOM_PADDING };
  const v = n;
  if (!Number.isFinite(v)) return { literal: false, cls: SAFE_BOTTOM_PADDING };
  if (v === 0) return { literal: true, cls: '0' };
  const step = v / 4;
  return { literal: true, cls: Number.isInteger(step) ? String(step) : `[${v}px]` };
};

const PROP = {
  padding: (v) => (typeof v === 'number' ? `p-${NUM(v)}` : null),
  paddingTop: (v) => `pt-${NUM(v)}`,
  paddingBottom: (v) => `pb-${NUM(v)}`,
  paddingLeft: (v) => `pl-${NUM(v)}`,
  paddingRight: (v) => `pr-${NUM(v)}`,
  paddingHorizontal: (v) => `px-${NUM(v)}`,
  paddingVertical: (v) => `py-${NUM(v)}`,
  gap: (v) => `gap-${NUM(v)}`,
  alignItems: (v) => ({ center: 'items-center', flexStart: 'items-start', flexEnd: 'items-end', stretch: 'items-stretch' })[v],
  justifyContent: (v) => ({ center: 'justify-center', flexStart: 'justify-start', flexEnd: 'justify-end', spaceBetween: 'justify-between' })[v],
  flexGrow: (v) => (v === 1 ? 'grow' : null),
};

/** `{ padding: 16, gap: 12 }` -> `p-4 gap-3`. Unrecognised keys are reported. */
function styleToClass(obj) {
  const out = [];
  const unknown = [];
  for (const [k, v] of Object.entries(obj)) {
    const fn = PROP[k];
    if (!fn) {
      unknown.push(k);
      continue;
    }
    const cls = fn(v);
    if (cls) out.push(cls);
  }
  return { classes: out.join(' '), unknown };
}

/** Parse the flat `{ k: v }` literals these files use (no nested objects). */
function parseStyleObject(src) {
  const body = src.trim().replace(/^\{|\}$/g, '');
  const entries = [];
  for (const m of body.matchAll(/(\w+):\s*([^,}]+)/g)) {
    let v = m[2].trim();
    if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v);
    else if (/^'([^']*)'$/.test(v)) v = v.slice(1, -1);
    entries.push([m[1], v]);
  }
  return entries;
}

let touched = 0;
const report = [];
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let s = before;

  s = s.replace(/ edges=\{\[[^\]]*\]\}/g, '');

  // `<ScrollView ...props...>` -> `<ScrollArea ...props...>`, translating
  // contentContainerStyle on the way through.
  s = s.replace(/<ScrollView\b/g, '<ScrollArea');

  s = s.replace(
    /contentContainerStyle=\{\{([^}]*)\}\}/g,
    (_m, body) => {
      const { classes, unknown } = styleToClass(Object.fromEntries(parseStyleObject(body)));
      if (unknown.length) report.push(`${file}: untranslated contentContainerStyle keys: ${unknown.join(', ')}`);
      return `contentClassName="${classes}"`;
    },
  );

  // Identifiers computed elsewhere (listContentStyle, jobsContentStyle, ...) are
  // hand-written consts; those get fixed by hand, not here.
  s = s.replace(
    /contentContainerStyle=\{(\w+)\}/g,
    (_m, name) => {
      report.push(`${file}: contentContainerStyle={${name}} is a computed style — needs a manual ContentClassName const`);
      return `contentClassName={${name}}`;
    },
  );

  // Drop the RN-only ScrollView props.
  // One line at a time. A `[^>]*` guard cannot work here — the handler arrow
  // `onRefresh={() => ...}` contains a `>` — and a lazy `[\s\S]*?` is worse
  // still: it never finds the `}}` it is looking for and eats the JSX that
  // follows.
  s = s.replace(/^\s*refreshControl=\{<RefreshControl.*$/gm, '');
  s = s.replace(/\n\s*nestedScrollEnabled/g, '');
  s = s.replace(/\n\s*keyboardShouldPersistTaps="[^"]*"/g, '');
  s = s.replace(/\n\s*showsVerticalScrollIndicator=\{?\w*\}?/g, '');
  s = s.replace(/\n\s*showsHorizontalScrollIndicator=\{?\w*\}?/g, '');
  s = s.replace(/ showsHorizontalScrollIndicator>/g, '>');

  s = s.replace(/<\/ScrollView>/g, '</ScrollArea>');

  // Fix the React import leftovers.
  s = s.replace(/^import \{ ScrollView \} from 'react-native';\n/gm, '');
  s = s.replace(/^import \{ Alert, ScrollView \} from 'react-native';\n/gm, "import { Alert } from 'react-native';\n");
  s = s.replace(/^import \{ RefreshControl, ([^}]*) \} from 'react-native';\n/gm, "import { $1 } from 'react-native';\n");
  s = s.replace(/\{ RefreshControl, /g, '{ ');
  s = s.replace(/, RefreshControl \}/g, ' }');
  s = s.replace(/RefreshControl, /g, '');

  if (s !== before) {
    writeFileSync(file, s);
    touched++;
  }
}
console.log(`codemod-scroll: rewrote ${touched} file(s)`);
if (report.length) {
  console.log('\nNeeds a hand:');
  for (const r of report) console.log('  ' + r);
}
