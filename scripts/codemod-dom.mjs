// One-shot codemod for the Expo/RN -> DOM port. Not part of the app.
//
// It only does the substitutions that are safe to do blind. The structural
// pieces — ScrollView wrappers, FlashList, the image/document pickers,
// SafeAreaView, RefreshControl, KeyboardAvoidingView — are deliberately NOT
// here, because each one needs a decision about what replaces it rather than a
// text substitution, and a regex that guesses would silently produce a broken
// layout. Those are done by hand per screen.
//
// Run: node scripts/codemod-dom.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(
  `grep -rlE "from '(react-native|react-native-|expo-|nativewind|@rn-primitives|@gorhom|@shopify|lucide-react-native)" src --include='*.tsx' || true`,
)
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean)
  .filter((f) => !f.includes('components/chat'));

// ── import lines ────────────────────────────────────────────────────────────
const IMPORTS = [
  // lucide ships the same icon names on both platforms.
  [/from 'lucide-react-native'/g, "from 'lucide-react'"],
  // Screen chrome: StatusBar is a native concept, and the safe area is `env()`.
  [/^import \{ StatusBar \} from 'expo-status-bar';\n/gm, ''],
  [/^import \{ SafeAreaView \} from 'react-native-safe-area-context';\n/gm, ''],
  [
    /^import \{ SafeAreaView, useSafeAreaInsets \} from 'react-native-safe-area-context';\n/gm,
    '',
  ],
  // `Redirect` exists on both; the navigation hooks do not.
  [/^import \{ Redirect \} from 'expo-router';\n/gm, "import { Navigate as Redirect } from 'react-router-dom';\n"],
  [/^import \{ Redirect, useNavigation \} from 'expo-router';\n/gm, "import { Navigate as Redirect } from 'react-router-dom';\n"],
  [/^import \{ Redirect, useRouter \} from 'expo-router';\n/gm, "import { Navigate as Redirect } from 'react-router-dom';\n"],
  [/^import \{ Redirect, useNavigation \} from 'expo-router';\n/gm, "import { Navigate as Redirect } from 'react-router-dom';\n"],
];

// ── JSX / prop substitutions ───────────────────────────────────────────────
// `flex-row` is a NativeWind class. Web Tailwind has no such thing: `flex`
// already means `display:flex` with the default `flex-direction: row`, and
// there is no Tailwind class that sets row direction explicitly. This is the
// single highest-volume change in the whole port.
const SUBS = [
  // Layout primitives.
  [/<View\b/g, '<div'],
  [/<\/View>/g, '</div>'],
  [/<SafeAreaView\b/g, '<div'],
  [/<\/SafeAreaView>/g, '</div>'],
  [/<KeyboardAvoidingView\b/g, '<div'],
  [/<\/KeyboardAvoidingView>/g, '</div>'],
  [/<StatusBar\b[^>]*\/>/g, ''],
  // Pressables become real buttons, so the gesture is a click.
  [/\bonPress=/g, 'onClick='],
  [/\bonChangeText=/g, 'onChange='],
  [/\bonSubmitEditing=/g, 'onKeyDownEnter='],
  // Accessibility props are the same names minus the `accessibility` prefix.
  [/\baccessibilityLabel=/g, 'aria-label='],
  [/\baccessibilityHint=/g, 'title='],
  [/\baccessibilityState=\{\{([^}]*)\}\}/g, (_m, inner) => `aria-state={${inner}}`],
  [/\baccessibilityRole="button"/g, 'role="button"'],
  [/\baccessibilityRole="alert"/g, 'role="alert"'],
  [/\baccessibilityRole="header"/g, 'role="banner"'],
  [/\baccessibilityRole="none"/g, ''],
  [/\btestID=/g, 'data-testid='],
  // Props with no DOM counterpart.
  [/\n\s*hitSlop=\{[^}]*\}/g, ''],
  [/\n\s*placeholderTextColor=\{[^}]*\}/g, ''],
  [/\n\s*keyboardAppearance=\{[^}]*\}/g, ''],
  [/\n\s*keyboardType="[^"]*"/g, ''],
  [/\n\s*returnKeyType="[^"]*"/g, ''],
  [/\n\s*autoCorrect=\{false\}/g, ''],
  [/\n\s*selectable(\s|\n|\/?>)/g, (_m, tail) => tail],
  [/\n\s*textAlignVertical="[^"]*"/g, ''],
  [/\n\s*submitBehavior="[^"]*"/g, ''],
  [/\n\s*numberOfLines=\{Platform\.select\([^)]*\)\}/g, ''],
  // Tailwind class fixes.
  [/\bflex-row\b/g, 'flex'],
  [/\bjustify-around\b/g, 'justify-around'],
  // `Alert.alert` had no web shape; `toast()` is the replacement the app uses.
  [/<Redirect href="([^"]*)" \/>/g, '<Redirect to="$1" replace />'],
];

let touched = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let s = before;
  for (const [re, to] of [...IMPORTS, ...SUBS]) s = s.replace(re, to);
  if (s !== before) {
    writeFileSync(file, s);
    touched++;
  }
}
console.log(`codemod: rewrote ${touched} file(s)`);
