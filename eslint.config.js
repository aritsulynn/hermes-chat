import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  // `**/…` and not a bare name: in flat config an ignore like `public` only
  // matches at the config root, so the Capacitor build output nested under
  // `android/app/**/assets/public` was being linted as source — 6,800+ errors
  // of minified bundle, none of them ours.
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.openchamber/**',
      '**/public/**',
      // Gradle output — native-bridge.js is a Capacitor-generated asset.
      '**/build/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React-Compiler-oriented rules (react-hooks v7). They flag deliberate
      // patterns here — notably the store updating refs during render so
      // callbacks frozen inside openWs() always read the latest values — and
      // adopting them is a refactor, not a lint config.
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',

      // TypeScript already checks these; `no-undef` false-positives on DOM
      // globals in ts files.
      'no-undef': 'off',
      // shadcn-style primitives legitimately take `any` in a few places.
      '@typescript-eslint/no-explicit-any': 'off',
      // Keep in step with tsconfig's noUnusedLocals/noUnusedParameters.
      // `ignoreRestSiblings` allows the `const { ignored, ...rest } = props`
      // idiom used to strip props before forwarding.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Applies to every file type, including the .mjs test scripts.
    rules: {
      // Best-effort cleanup blocks are intentionally empty: `catch {}` is the
      // "never fail the app over this" pattern.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // The zero-width-char classes in utils/messages are deliberate.
      'no-misleading-character-class': 'off',
      'preserve-caught-error': 'off',
    },
  },
  {
    // Test runner scripts and config files run in Node.
    files: ['**/*.mjs', '**/*.cjs', '*.config.js', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
