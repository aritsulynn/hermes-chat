// File picking.
//
// The browser's file chooser is an `<input type="file">`.
//
// What it hands back matters: the attachment pipeline identifies an attachment
// by its `uri`, and that uri also becomes a cache key (see
// services/media-cache). A `data:` URL would be megabytes in a Map key and in
// every React key derived from it, so this returns `blob:` URLs instead.
//
// Two things worth knowing about the blob URLs:
//   - They are revoked by the browser when the document unloads, not before, so
//     there is nothing to leak within a session — but the caller must revoke
//     explicitly if it drops an attachment before the page goes away.
//   - `fetch()` on a blob URL works, which is all the upload path needs.
//
// The input is created, clicked and discarded per call rather than kept mounted
// and hidden. A persistent one has to have its `value` cleared by hand between
// uses or picking the same file twice fires nothing, and a transient one has no
// state to get wrong.
export interface PickedFile {
  name: string;
  mime: string;
  /** `blob:` URL. Pass this straight through as the attachment's `uri`. */
  uri: string;
  size: number;
  /** A data URL, for the handful of places that want bytes rather than a URI. */
  dataUrl: string;
}

/**
 * @param accept  An `accept` attribute value, e.g. 'image/*' or '.json,text/*'.
 * @param multiple  Allow selecting more than one file.
 */
export function pickFiles(options: { accept?: string; multiple?: boolean } = {}): Promise<PickedFile[]> {
  const { accept, multiple = false } = options;
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    if (multiple) input.multiple = true;
    input.style.cssText = 'position:fixed;left:-9999px;opacity:0';

    let settled = false;
    const finish = (files: PickedFile[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      window.removeEventListener('focus', onFocus);
      resolve(files);
    };

    // There is no "cancel" event on a file input. The window regaining focus
    // without a change event is the only signal that the chooser was dismissed,
    // and it fires after a successful pick too — hence the `settled` guard and
    // the delay, so a real selection always wins the race.
    const onFocus = () => setTimeout(() => finish([]), 500);

    input.addEventListener('change', () => {
      const list = Array.from(input.files ?? []);
      if (!list.length) return finish([]);
      Promise.all(
        list.map(
          (file) =>
            new Promise<PickedFile>((done) => {
              const reader = new FileReader();
              reader.onerror = () =>
                done({ name: file.name, mime: file.type, uri: '', size: file.size, dataUrl: '' });
              reader.onload = () => {
                const dataUrl = String(reader.result ?? '');
                done({
                  name: file.name,
                  mime: file.type || 'application/octet-stream',
                  uri: URL.createObjectURL(file),
                  size: file.size,
                  dataUrl,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      ).then((files) => finish(files.filter((f) => f.uri)));
    });

    document.body.appendChild(input);
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

/** Single-file convenience wrapper, for the paths that only ever take one. */
export async function pickFile(options: { accept?: string } = {}): Promise<PickedFile | null> {
  const [first] = await pickFiles(options);
  return first ?? null;
}

/** Read a picked file as text, for callers that want content rather than bytes. */
export function pickFileAsText(accept?: string): Promise<{ name: string; text: string } | null> {
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
