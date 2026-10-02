// The approval body of the in-chat ask sheet, as a shadcn Questionnaire.
//
// Same suite as the clarify stepper, but single-shot: tapping a row answers
// immediately (no Send step), exactly like the old stacked buttons. Each
// choice carries its label + hint as two stacked spans — the suite's
// ChoiceLabel takes any children, so no wire change is needed: the payload is
// still the raw choice value (`once`/`session`/`always`/`deny`).
//
// Rows are bordered, not filled, so they read the same in every theme. The old
// buttons used `bg-primary`, which in the openchamber dark theme is a pale
// terracotta with near-white text — the washed-out look this replaces.
import { useEffect, useRef, useState } from 'react';
import type { ServerAsk } from '../../services/gateway-ws';
import { Questionnaire } from '../ui/questionnaire';

const CHOICE_META: Record<string, { label: string; hint: string; row: string }> = {
  // Tinted rows so scope reads at a glance: green = one-off and safe, plain =
  // scoped to this chat, amber = persistent (think twice), red = stop. Alpha
  // tints work in both themes without the washed-fill problem `bg-primary`
  // had in the openchamber dark theme.
  once: { label: 'Allow once', hint: 'Just this command', row: 'bg-emerald-500/[0.08] border-emerald-500/30' },
  session: { label: 'Allow for this session', hint: 'Until the chat ends', row: '' },
  always: { label: 'Always allow', hint: 'Saved to the allow-list', row: 'bg-amber-500/[0.08] border-amber-500/30' },
  deny: { label: 'Deny', hint: 'The agent stops here', row: 'bg-red-500/[0.08] border-red-500/30' },
};
const CHOICE_ORDER = ['once', 'session', 'always', 'deny'];

export function ApprovalQuestionnaire({
  ask,
  onApprove,
}: {
  ask: ServerAsk;
  /** Same contract as the old buttons: true when the answer was accepted. */
  onApprove: (choice: string) => boolean;
}) {
  const raw: string[] =
    Array.isArray(ask.params.choices) && ask.params.choices.length > 0
      ? ask.params.choices.map(String)
      : ['once', 'deny'];
  const choices = [...raw].sort((a, b) => CHOICE_ORDER.indexOf(a) - CHOICE_ORDER.indexOf(b));
  // Answered once — further taps are ignored while the gateway resolves.
  const [sent, setSent] = useState<string | null>(null);
  const sentRef = useRef<string | null>(null);
  useEffect(() => {
    sentRef.current = sent;
  }, [sent]);

  const answer = (choice: string) => {
    if (sentRef.current) return;
    if (onApprove(choice)) setSent(choice);
  };

  return (
    <Questionnaire.Root
      // `disabled` mirrors the rendered Choices below — the suite warns in dev
      // when the items definition and the rendered tree disagree.
      items={[
        {
          name: 'approval',
          required: false,
          choices: choices.map((c) => ({ value: c, disabled: sent !== null })),
        },
      ]}
      shortcuts="letters"
      // Enter on a focused row submits the form — answer the checked choice so
      // keyboard users get the same one-tap behaviour as pointer users.
      onSubmit={(e) => {
        e.preventDefault();
        const value = new FormData(e.currentTarget).get('approval');
        if (typeof value === 'string' && value) answer(value);
      }}>
      <Questionnaire.Item name="approval" required={false}>
        <Questionnaire.Choices>
          {choices.map((c) => {
            const deny = c === 'deny';
            const meta = CHOICE_META[c] ?? { label: c, hint: '', row: '' };
            return (
              <Questionnaire.Choice
                key={c}
                value={c}
                disabled={sent !== null}
                onChange={(e) => answer(e.target.value)}
                className={meta.row}>
                <Questionnaire.ChoiceInput />
                <Questionnaire.ChoiceLabel className="flex flex-col gap-0.5">
                  <span className={`text-[15px] font-semibold ${deny ? 'text-red-600 dark:text-red-400' : ''}`}>
                    {meta.label}
                  </span>
                  {!!meta.hint && (
                    <span className="text-[12px] font-normal text-neutral-500 dark:text-neutral-400">{meta.hint}</span>
                  )}
                </Questionnaire.ChoiceLabel>
                <Questionnaire.ChoiceShortcut />
              </Questionnaire.Choice>
            );
          })}
        </Questionnaire.Choices>
        <Questionnaire.Error />
      </Questionnaire.Item>
    </Questionnaire.Root>
  );
}
