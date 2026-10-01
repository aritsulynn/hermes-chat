// Clipboard write with a fallback.
//
// `navigator.clipboard` only exists in a secure context, and this client is
// routinely served from a plain-HTTP gateway on a LAN address
// (http://192.168.x.x:9119) — which is not one. There, `navigator.clipboard` is
// simply `undefined` and a copy button fails silently, which is worse than the
// deprecated `execCommand` path below.
//
// Returns whether the copy landed, so a caller can show "Copied" only when it
// actually did. Lives in services/ rather than utils/ because it needs a DOM:
// utils/ is the pure-helper folder that the node:test suite imports directly,
// and there is nothing meaningful to assert about this without one.
export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const el = document.createElement('textarea');
    el.value = text;
    // Off-screen but still focusable — a hidden or zero-size element has an
    // empty selection and copies nothing.
    el.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    el.remove();
    return ok;
  } catch {
    return false;
  }
}
