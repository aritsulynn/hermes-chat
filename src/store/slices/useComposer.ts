// Composer slice — the input text and its per-session drafts, attachments, and
// the copy-to-clipboard feedback. Refs/raw setters are returned because session
// open/resume/new/switch and the send path also write drafts and input.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { profileSessionKey } from '../helpers';
import { writeClipboard } from '../../services/clipboard';
import type { StoreCtx } from '../ctx';
import type { Attachment } from '../../utils/messages';

export interface ComposerSlice {
  input: string;
  inputRaw: string;
  setInput: (v: string) => void;
  setInputRaw: Dispatch<SetStateAction<string>>;
  draftsRef: MutableRefObject<Map<string, string>>;
  draftKeyRef: MutableRefObject<string>;
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  copiedId: string | null;
  copyText: (id: string, text: string) => Promise<void>;
}

export function useComposerSlice({ activeProfile, sessionKey, sessionId }: StoreCtx): ComposerSlice {
  const [inputRaw, setInputRaw] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyTimer = useRef<any>(null);
  // Per-session composer drafts — switching rooms no longer wipes typing.
  const draftsRef = useRef<Map<string, string>>(new Map());
  const draftKeyRef = useRef<string>('__none__');
  useEffect(() => {
    const id = sessionKey ?? sessionId;
    draftKeyRef.current = id ? profileSessionKey(activeProfile, id) : `${activeProfile}::__none__`;
  }, [activeProfile, sessionKey, sessionId]);
  const setInput = useCallback((v: string) => {
    draftsRef.current.set(draftKeyRef.current, v);
    // Bound the per-session draft map — one entry per visited session otherwise.
    if (draftsRef.current.size > 50) {
      const oldest = draftsRef.current.keys().next().value;
      if (oldest !== undefined && oldest !== draftKeyRef.current) draftsRef.current.delete(oldest);
    }
    setInputRaw(v);
  }, []);
  const input = inputRaw;

  // Cleanup the copy-timeout on unmount so it can't fire late.
  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );
  const copyText = useCallback(async (id: string, text: string) => {
    if (!(await writeClipboard(text))) return;
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  return {
    input,
    inputRaw,
    setInput,
    setInputRaw,
    draftsRef,
    draftKeyRef,
    attachments,
    setAttachments,
    copiedId,
    copyText,
  };
}
