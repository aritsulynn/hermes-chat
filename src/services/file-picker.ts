// File picking.
//
// expo-document-picker and expo-image-picker both open a native chooser and
// hand back a URI, sometimes base64. The browser's equivalent is an
// <input type="file">, and it gives the bytes directly — which is actually
// better, because the upload path wants a data URL anyway and reading a
// `blob:` URI back out again was a round trip for nothing.
//
// The input is created, clicked and discarded per call rather than kept mounted
// and hidden. A persistent one has to have its `value` cleared by hand between
// uses or picking the same file twice fires nothing, and a transient one has no
// state to get wrong.
export interface PickedFile {
  name: string;
  mime: string;
  /** base64, without the data-URL prefix. */
  base64: string;
  dataUrl: string;
  size: number;
}

/**
 * @param accept  An `accept` attribute value, e.g. 'image/*' or '.json,text/*'.
 */
export function pickFile(accept?: string): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.cssText = 'position:fixed;left:-9999px;opacity:0';

    let settled = false;
    const finish = (value: PickedFile | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener('focus', onFocus);
      resolve(value);
    };

    // There is no "cancel" event on a file input. The window regaining focus
    // without a change event is the only signal that the chooser was dismissed,
    // and it fires after a successful pick too — hence the `settled` guard.
    const onFocus = () => setTimeout(() => finish(null), 500);

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      const reader = new FileReader();
      reader.onerror = () => finish(null);
      reader.onload = () => {
        const result = String(reader.result ?? '');
        const comma = result.indexOf(',');
        const base64 = comma >= 0 ? result.slice(comma + 1) : '';
        finish({
          name: file.name,
          mime: file.type || 'application/octet-stream',
          base64,
          dataUrl: result,
          size: file.size,
        });
      };
      reader.readAsDataURL(file);
    });

    document.body.appendChild(input);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

/** Read a picked file as text. Used where the caller wants content, not bytes. */
export async function pickFileAsText(accept?: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.cssText = 'position:fixed;left:-9999px;opacity:0';
    let settled = false;
    const finish = (v: { name: string; text: string } | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener('focus', onFocus);
      resolve(v);
    };
    const onFocus = () => setTimeout(() => finish(null), 500);
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      file
        .text()
        .then((text) => finish({ name: file.name, text }))
        .catch(() => finish(null));
    });
    document.body.appendChild(input);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}
