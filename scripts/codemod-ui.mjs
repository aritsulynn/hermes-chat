// Codemod pass 2: the RN primitives that have a one-to-one replacement in
// components/ui. Not part of the app.
//
//   RN Text            -> ui/text  (keeps `numberOfLines`, which the shadcn Text
//                         maps to truncate/line-clamp)
//   RN ActivityIndicator -> ui/bits Spinner
//   RN Switch          -> ui/switch
//
// Run after codemod-dom.mjs: node scripts/codemod-ui.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const files = execSync(`grep -rlE "from 'react-native'" src --include='*.tsx' || true`)
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);

/** Depth-aware relative path back to src/ from a file. */
function up(file) {
  const depth = file.split('/').length - 2; // minus 'src' and the filename
  return '../'.repeat(depth) || './';
}

let touched = 0;
for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const rel = up(file);
  let s = before;

  // ── strip the RN import of whatever we are about to replace ──────────────
  s = s.replace(/^import \{([^}]*)\} from 'react-native';\n/gm, (_m, inner) => {
    const keep = inner
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x && !/^(Text|ActivityIndicator|Switch|View|Pressable)$/.test(x));
    return keep.length ? `import { ${keep.join(', ')} } from 'react-native';\n` : '';
  });

  // ── RN Text -> the shadcn Text ───────────────────────────────────────────
  if (/<Text[\s/>]/.test(s)) {
    s = s.replace(/<Text(?=[\s/>])/g, '<UIText').replace(/<\/Text>/g, '</UIText>');
    if (!/import \{[^}]*Text as UIText[^}]*\} from/.test(s)) {
      s = `import { Text as UIText } from '${rel}components/ui/text';\n` + s;
    }
  }

  // ── RN ActivityIndicator -> Spinner ──────────────────────────────────────
  if (/<ActivityIndicator[\s/>]/.test(s)) {
    // `size="small"|"large"` maps to a pixel size; `color` carries over.
    s = s.replace(/<ActivityIndicator\b([^>]*?)\/>/g, (_m, attrs) => {
      const size = /size="large"/.test(attrs) ? 24 : 14;
      const color = /color=(?:"([^"]*)"|\{([^}]*)\})/.exec(attrs);
      const c = color ? (color[1] ?? `{${color[2]}}`) : 'currentColor';
      return `<Spinner size={${size}} color=${c} />`;
    });
    s = s.replace(/^import \{[^}]*\} from 'react-native';\n/gm, '');
    if (!/Spinner[^\n]*from/.test(s)) {
      s = s.replace(
        new RegExp(`(import \\{ Text as UIText \\} from '[^']*';\\n)`),
        `$1import { Spinner } from '${rel}components/ui/bits';\n`,
      );
    }
  }

  if (s !== before) {
    writeFileSync(file, s);
    touched++;
  }
}
console.log(`codemod-ui: rewrote ${touched} file(s)`);
