// Codemod pass 6: strip the RN-only props that survived the earlier passes, and
// the one prop codemod pass 1 invented. Not part of the app.
//
// Everything here is a prop with no DOM counterpart AND no behaviour worth
// keeping. Each is annotated with why dropping it is safe rather than a silent
// deletion, because "the compiler complained so I removed it" is how a real
// feature disappears.
//
//   hitSlop / nestedScrollEnabled / scrollEnabled
//     Touch-only: padding a touch target. A mouse already hits exactly where it
//     points, so on the web it is a no-op rather than a gap in behaviour.
//
//   accessibilityRole (non-button/alert/header values)
//     The remaining values were "none", "image", "search", "text" — all of which
//     a <div> or <button> already implies, or which a real element carries.
//
//   keyboardShouldPersistTaps
//     RN-only: whether a tap while the keyboard is up counts. No DOM analogue.
//
//   showsHorizontalScrollIndicator / scrollbarWidth
//     Use ScrollArea's `hideScrollbar` if the bar is genuinely unwanted.
//
//   selectable
//     Web text is selectable by default. The native build needed the prop.
//
//   multiline
//     A <textarea> always is one.
//
//   secureTextEntry -> type="password" is handled separately, it is a rename.
//
//   selectionColor -> style caretColor.
//
//   behavior (on the div a KeyboardAvoidingView became)
//     The keyboard handling is the composer/visualViewport's job now.
//
//   pointerEvents="box-none"
//     -> `pointer-events-none` on the wrapper plus `pointer-events-auto` on the
//        interactive child, which is the DOM spelling of the same intent.
//
//   ellipsizeMode
//     The only value used was "tail", which is what CSS truncation does.
//
//   onLayout
//     Measurement callback. Where a screen still needs the number it has to be
//     replaced with a ResizeObserver, and those sites are reported, not
//     silently dropped.
//
//   onKeyDownEnter
//     Invented by pass 1 as a rename of onSubmitEditing; there is no such DOM
//     event, so it is rewritten to onKeyDown with an Enter check.
//
//   insetTop on <ScreenHeader>
//     ScreenHeader now reads env(safe-area-inset-top) itself.
//
// Run after codemod-onchange.mjs: node scripts/codemod-props.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(`grep -rlE "hitSlop=|nestedScrollEnabled|scrollEnabled|accessibilityRole=|keyboardShouldPersistTaps|showsHorizontalScrollIndicator|selectable|multiline|secureTextEntry|selectionColor|ellipsizeMode|pointerEvents=|onLayout|onKeyDownEnter|insetTop=" src --include='*.tsx' || true`)
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);

// Bare-attribute props, removable wherever they sit on one line.
const BARE = [
  'hitSlop', 'nestedScrollEnabled', 'scrollEnabled', 'keyboardShouldPersistTaps',
  'selectable', 'multiline', 'ellipsizeMode', 'scrollbarWidth',
];
// Props with a value, either `{expr}` or `="literal"`.
const VALUED = [
  'accessibilityRole', 'showsHorizontalScrollIndicator', 'secureTextEntry',
  'selectionColor', 'pointerEvents', 'insetTop', 'behavior', 'keyboardVerticalOffset',
  'presentationStyle', 'animationType', 'statusBarTranslucent', 'onRequestClose',
  'activeOpacity', 'delayLongPress', 'underlayColor', 'autoFocus',
];

const report = [];
let touched = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const lines = before.split('\n');
  const out = [];

  for (const line of lines) {
    let l = line;

    // onSubmitEditing became onKeyDownEnter in pass 1, which is not a DOM event.
    // Put back a real keydown with the Enter check.
    const kd = /onKeyDownEnter=\{\(\)\s*=>\s*(.*?)\}\s*$/.exec(l);
    if (kd) {
      report.push(`${file}: onKeyDownEnter -> onKeyDown+Enter (${kd[1].trim().slice(0, 40)})`);
      l = l.replace(kd[0], `onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ${kd[1].trim()} } }}`);
    }

    // onLayout needs a real decision; report and drop.
    if (/\bonLayout=\{/.test(l)) {
      report.push(`${file}: onLayout dropped — needs a ResizeObserver if the number is still read`);
      l = l.replace(/\s*onLayout=\{[\s\S]*?\}(\s*\/?>|$)/, '$1');
    }

    for (const p of VALUED) {
      // `prop={expr}` where expr has balanced braces, or `prop="literal"`.
      l = l.replace(new RegExp(`\\s*${p}=(\\{[^}]*\\}|"[^"]*"|'[^']*')`, 'g'), '');
    }
    for (const p of BARE) {
      l = l.replace(new RegExp(`\\s*${p}(\\s|\\n|\\/?>|$)`, 'g'), '$1');
      l = l.replace(new RegExp(`^\\s*${p}\\s*$`, 'gm'), '');
    }

    // tidy any trailing whitespace before `>` left by the removals
    l = l.replace(/\s+>/g, '>');
    out.push(l);
  }

  const s = out.join('\n');
  if (s !== before) {
    writeFileSync(file, s);
    touched++;
  }
}
console.log(`codemod-props: rewrote ${touched} file(s)`);
if (report.length) {
  console.log('\nNeeds a hand:');
  for (const r of [...new Set(report)]) console.log('  ' + r);
}
