// The clarify body of the in-chat ask sheet, as a shadcn Questionnaire.
//
// One gateway `clarify` ask becomes one questionnaire: each server question is
// an Item stepped through with Progress + Back/Next, choices are pills with
// letter shortcuts, and a choiceless question renders a free-form Input. The
// submit shape is unchanged — `{ answer }` for a single question,
// `{ answers }` (qid→answer, multi-selects joined with ', ') for several — so
// the gateway cannot tell the pills were swapped out.
//
// Partial progress still locks per question via `clarify.lock` (debounced like
// before) so the agent sees answers landing instead of waiting for Send.
// Locked answers restored from a reconnect payload arrive as defaultChecked /
// defaultValue; a new request remounts via `key={ask.rpcId}` at the call site,
// which is what resets the suite's internal selection.
import { useEffect, useRef } from 'react';
import type { GatewayWs, ServerAsk } from '../../services/gateway-ws';
import { parseClarify } from '../../utils/messages';
import { Questionnaire } from '../ui/questionnaire';

export function ClarifyQuestionnaire({
  ask,
  gw,
  onResult,
}: {
  ask: ServerAsk;
  gw: GatewayWs | null;
  onResult: (result: Record<string, unknown>) => boolean;
}) {
  const { single, questions } = parseClarify(ask);
  const items = questions.map((q) => ({
    name: q.qid,
    required: true,
    choices: q.choices.map((c) => ({ value: c })),
  }));
  // Which button was tapped is irrelevant here — the suite only submits once
  // everything validates, and validation (required on every item) runs inside
  // it before our onSubmit fires.
  const lockTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(
    () => () => {
      for (const timer of Object.values(lockTimers.current)) clearTimeout(timer);
    },
    [],
  );

  const readValue = (form: HTMLFormElement, qid: string, multi: boolean): string => {
    const fd = new FormData(form);
    return multi ? fd.getAll(qid).map(String).join(', ') : String(fd.get(qid) ?? '');
  };

  // Lock the question being touched so the agent watches the answer land.
  // `clarify.lock` takes the same payload shape the old pills sent.
  const handleChange = (e: React.FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    const target = e.target as HTMLInputElement | null;
    const qid = target?.name;
    if (!qid) return;
    const q = questions.find((row) => row.qid === qid);
    if (!q) return;
    if (lockTimers.current[qid]) clearTimeout(lockTimers.current[qid]);
    lockTimers.current[qid] = setTimeout(() => {
      gw?.call('clarify.lock', {
        request_id: ask.rpcId,
        question_id: qid,
        answer: readValue(form, qid, q.multiSelect),
      }).catch(() => {});
    }, 300);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (single) {
      const q = questions[0];
      onResult({ answer: readValue(form, q.qid, q.multiSelect) });
      return;
    }
    const answers: Record<string, string> = {};
    for (const q of questions) answers[q.qid] = readValue(form, q.qid, q.multiSelect);
    onResult({ answers });
  };

  const lockedOf = (qid: string): string[] => {
    const q = questions.find((row) => row.qid === qid);
    if (!q?.lockedAnswer) return [];
    return q.multiSelect ? q.lockedAnswer.split(',').map((s) => s.trim()) : [q.lockedAnswer];
  };

  return (
    <Questionnaire.Root items={items} shortcuts="letters" onSubmit={handleSubmit} onChange={handleChange}>
      {questions.length > 1 && <Questionnaire.Progress />}
      {questions.map((q) => (
        <Questionnaire.Item key={q.qid} name={q.qid} required multiple={q.multiSelect}>
          {!!q.question && <Questionnaire.Title>{q.question}</Questionnaire.Title>}
          <Questionnaire.Choices>
            {q.choices.map((c) => (
              <Questionnaire.Choice key={c} value={c} defaultChecked={lockedOf(q.qid).includes(c)}>
                <Questionnaire.ChoiceInput />
                <Questionnaire.ChoiceLabel>{c}</Questionnaire.ChoiceLabel>
                <Questionnaire.ChoiceShortcut />
              </Questionnaire.Choice>
            ))}
            {q.choices.length === 0 && (
              <Questionnaire.Input
                placeholder="Type your answer…"
                aria-label={q.question || 'Your answer'}
                defaultValue={q.lockedAnswer ?? undefined}
              />
            )}
          </Questionnaire.Choices>
          <Questionnaire.Error />
        </Questionnaire.Item>
      ))}
      {/* Send stays right via ml-auto: with a single question Previous hides
          itself, and justify-between would strand the button at the start. */}
      <div className="mt-2 flex items-center gap-2">
        <Questionnaire.Previous />
        <div className="ml-auto flex items-center gap-2">
          <Questionnaire.Next />
          <Questionnaire.Submit>Send answer</Questionnaire.Submit>
        </div>
      </div>
    </Questionnaire.Root>
  );
}
