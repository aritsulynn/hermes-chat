// Create/edit a SKILL.md from the mobile app.
//
// Ported from Hermes Desktop `web/src/components/SkillEditorDialog.tsx`. Same
// backend contract (`PUT /api/skills/content`, `POST /api/skills`) over the
// app's authed ops helpers.
//
// Layout note: this is a full-screen Radix dialog (same shape as the SKILL.md
// viewer next door), NOT a bottom sheet. A `h-[92dvh]` sheet let the action row
// fall below the fold on a phone — the buttons rendered but could not be
// tapped. `fixed inset-0` + a `min-h-0 flex-1` scroller keeps the footer pinned
// on screen at every viewport height.
import { useCallback, useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Spinner } from '../../../components/ui/bits';
import { errMsg } from '../../../utils/messages';
import { brandColor } from '../../../theme';
import { createSkill, getSkillContent, updateSkillContent } from '../../../services/skills';

const CREATE_TEMPLATE = `---
name: my-skill
description: One-line description of when to use this skill.
---

# My Skill

Numbered steps, exact commands, and pitfalls go here.
`;

const LABEL_CLASS = 'text-xs font-semibold text-neutral-700 dark:text-neutral-300';
const FIELD_CLASS =
  'rounded-xl border border-border px-3.5 py-2.5 text-sm text-neutral-950 dark:bg-input/30 dark:text-neutral-100';

export interface SkillEditorProps {
  open: boolean;
  /** Skill name to edit, or null for create mode. */
  editName: string | null;
  dark: boolean;
  opsGet: (path: string) => Promise<unknown>;
  opsMut: (path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) => Promise<unknown>;
  getAuthScope: () => unknown;
  onClose: () => void;
  /** Called after a successful save so the screen can refresh its list. */
  onSaved: (name: string) => void;
}

export function SkillEditor({
  open,
  editName,
  dark,
  opsGet,
  opsMut,
  getAuthScope,
  onClose,
  onSaved,
}: SkillEditorProps) {
  const isEdit = editName !== null;

  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [content, setContent] = useState(isEdit ? '' : CREATE_TEMPLATE);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName('');
    setCategory('');
    setError(null);
    setContent(editName ? '' : CREATE_TEMPLATE);
    setLoading(Boolean(editName));
    if (!editName) return;
    const scope = getAuthScope();
    let cancelled = false;
    getSkillContent(opsGet, editName)
      .then((res) => {
        if (!cancelled && getAuthScope() === scope) setContent(res.content);
      })
      .catch((e) => {
        if (!cancelled && getAuthScope() === scope) setError(errMsg(e));
      })
      .finally(() => {
        if (!cancelled && getAuthScope() === scope) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, editName, opsGet, getAuthScope]);

  const handleSave = useCallback(async () => {
    const scope = getAuthScope();
    setError(null);
    if (!isEdit && !name.trim()) {
      setError('Skill name is required.');
      return;
    }
    if (!content.trim()) {
      setError('SKILL.md content is required.');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await updateSkillContent(opsMut, editName, content);
        if (getAuthScope() !== scope) return;
        onSaved(editName);
      } else {
        const trimmed = name.trim();
        await createSkill(opsMut, { name: trimmed, content, category });
        if (getAuthScope() !== scope) return;
        onSaved(trimmed);
      }
      onClose();
    } catch (e) {
      if (getAuthScope() === scope) setError(errMsg(e));
    } finally {
      if (getAuthScope() === scope) setSaving(false);
    }
  }, [category, content, editName, getAuthScope, isEdit, name, onClose, onSaved, opsMut]);

  if (!open) return null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        {/* z-[60]: the SKILL.md viewer is a z-50 dialog; the editor opens on top
            of it before the viewer is unmounted. */}
        <DialogPrimitive.Content className="fixed inset-0 z-[60] flex flex-col bg-popover outline-hidden dark:bg-background">
          <DialogPrimitive.Title className="sr-only">
            {isEdit ? `Edit skill ${editName}` : 'New skill'}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {isEdit ? 'Rewrite this skill SKILL.md.' : 'Create a new skill.'}
          </DialogPrimitive.Description>
          <div
            className="flex min-h-0 flex-1 flex-col"
            style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close editor"
                onClick={onClose}
                className="h-11 w-11 shrink-0 rounded-md sm:h-11 sm:w-11">
                <X size={20} color={dark ? '#eee' : '#333'} />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm font-bold text-neutral-900 dark:text-white">
                  {isEdit ? editName : 'New skill'}
                </div>
                <div className="mt-0.5 text-[11px] text-neutral-400">
                  {isEdit ? 'Edit SKILL.md' : 'Author a custom SKILL.md'}
                </div>
              </div>
              {/* Save lives in the header, not a bottom bar: on a phone a pinned
                  footer can sit under the browser/viewport chrome, while a
                  top-of-screen action is always reachable. */}
              <Button
                aria-label={isEdit ? 'Save changes' : 'Create skill'}
                onClick={() => void handleSave()}
                disabled={saving || loading}
                className="h-auto sm:h-auto shrink-0 rounded-xl bg-brand px-4 py-2.5">
                <span className="text-sm font-semibold text-white">
                  {saving ? 'Saving…' : isEdit ? 'Save' : 'Create'}
                </span>
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+16px)]">
              <div className="flex flex-col gap-3">
                {!isEdit && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label className={`mb-1 ${LABEL_CLASS}`}>Name *</Label>
                      <Input
                        autoFocus
                        autoCapitalize="none"
                        placeholder="my-skill"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={FIELD_CLASS}
                      />
                    </div>
                    <div>
                      <Label className={`mb-1 ${LABEL_CLASS}`}>Category (optional)</Label>
                      <Input
                        autoCapitalize="none"
                        placeholder="devops"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className={FIELD_CLASS}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <Label className={`mb-1 ${LABEL_CLASS}`}>SKILL.md *</Label>
                  {loading ? (
                    <div className="flex items-center justify-center py-16">
                      <Spinner size={20} color={brandColor(dark)} />
                    </div>
                  ) : (
                    <Textarea
                      spellCheck={false}
                      className="min-h-[320px] resize-y rounded-xl border border-border px-3 py-2 font-mono text-xs leading-relaxed text-neutral-950 dark:bg-input/30 dark:text-neutral-100"
                      value={content}
                      onChange={(e) => setContent(e.target.value)}
                    />
                  )}
                </div>

                {error && (
                  <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-2 dark:border-red-950 dark:bg-red-950/30">
                    <div className="whitespace-pre-wrap text-xs text-red-700 dark:text-red-300">{error}</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
