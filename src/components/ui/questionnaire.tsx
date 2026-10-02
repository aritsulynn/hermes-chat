// Questionnaire — the in-chat clarify stepper.
//
// Styled wrapper around shadcn's questionnaire primitives
// (`@shadcn/react/questionnaire`), the same way message-scroller.tsx wraps its
// own suite. The primitives are unstyled and headless-ish: Root renders a
// <form>, each Item a <fieldset> (one question per step), Choice a <label>
// carrying `data-checked` while its answer is selected. The classes below are
// what make that read as our pill UI rather than a raw form.
//
// Choice state rides on `data-checked` (presence selector), not on a React
// prop, because the suite owns selection internally and only hands the form
// over on submit. The native inputs stay in the tree as `sr-only` so keyboard
// and screen readers keep working; the label draws the focus ring via
// `focus-within`.
import * as React from 'react';
import { Questionnaire as Primitive } from '@shadcn/react/questionnaire';
import { cn } from '@/utils/cn';

function Root({ className, ...props }: React.ComponentProps<typeof Primitive.Root>) {
  return <Primitive.Root data-slot="questionnaire" className={cn('flex flex-col gap-3', className)} {...props} />;
}

function Progress({ className, ...props }: React.ComponentProps<typeof Primitive.Progress>) {
  return (
    <Primitive.Progress
      data-slot="questionnaire-progress"
      className={cn('text-xs text-neutral-500 dark:text-neutral-400', className)}
      {...props}
    />
  );
}

function Item({ className, ...props }: React.ComponentProps<typeof Primitive.Item>) {
  // NOTE: this gap does NOT separate the Title from the rows. Title renders as
  // a <legend>, and browsers refuse to treat legend as a flex item of the
  // fieldset, so it sits outside this gap entirely. The title-to-rows distance
  // lives on Choices' margin-top below; this gap only spaces rows from Error.
  return (
    <Primitive.Item data-slot="questionnaire-item" className={cn('flex flex-col gap-2.5', className)} {...props} />
  );
}

function Title({ className, ...props }: React.ComponentProps<typeof Primitive.Title>) {
  return (
    <Primitive.Title
      data-slot="questionnaire-title"
      className={cn('p-0 text-sm text-neutral-700 dark:text-neutral-200', className)}
      {...props}
    />
  );
}

function Description({ className, ...props }: React.ComponentProps<typeof Primitive.Description>) {
  return (
    <Primitive.Description
      data-slot="questionnaire-description"
      className={cn('text-xs text-neutral-500 dark:text-neutral-400', className)}
      {...props}
    />
  );
}

function Choices({ className, ...props }: React.ComponentProps<typeof Primitive.Choices>) {
  // Stacked full-width rows, not wrapping pills: clarify options are often long
  // Thai sentences, and wrapping pills end up ragged with uneven widths.
  //
  // The margin-top is load-bearing and belongs here, not on Item's gap: Title
  // is a <legend>, which browsers exclude from the fieldset's flex layout, so
  // no gap on Item can ever push the rows away from the question.
  return (
    <Primitive.Choices
      data-slot="questionnaire-choices"
      className={cn('mt-2 flex flex-col gap-2', className)}
      {...props}
    />
  );
}

function Choice({ className, ...props }: React.ComponentProps<typeof Primitive.Choice>) {
  // Full-width row: the shortcut chip leads (fixed, never squeezed), the label
  // takes the rest and wraps inside it. Stacked rows instead of wrapping pills
  // because clarify options are often long Thai sentences — wrapping pills end
  // up ragged with the shortcut letter stranded at the end of the text.
  return (
    <Primitive.Choice
      data-slot="questionnaire-choice"
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-2xl border border-border px-3 py-2.5 text-left text-sm text-neutral-950 transition-colors',
        'dark:text-neutral-100',
        'focus-within:outline-none focus-within:ring-2 focus-within:ring-brand/40',
        'data-[checked]:border-transparent data-[checked]:bg-brand data-[checked]:text-white',
        'has-[input:disabled]:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

function ChoiceInput({ className, ...props }: React.ComponentProps<typeof Primitive.ChoiceInput>) {
  return (
    <Primitive.ChoiceInput data-slot="questionnaire-choice-input" className={cn('sr-only', className)} {...props} />
  );
}

function ChoiceLabel({ className, ...props }: React.ComponentProps<typeof Primitive.ChoiceLabel>) {
  return (
    <Primitive.ChoiceLabel
      data-slot="questionnaire-choice-label"
      className={cn('min-w-0 flex-1', className)}
      {...props}
    />
  );
}

function ChoiceShortcut({ className, ...props }: React.ComponentProps<typeof Primitive.ChoiceShortcut>) {
  // Leads the row as a fixed kbd-like chip (`order-first`), so a long wrapping
  // label can never push it around or swallow it mid-sentence.
  return (
    <Primitive.ChoiceShortcut
      data-slot="questionnaire-choice-shortcut"
      className={cn(
        'order-first flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-current text-[11px] font-semibold opacity-60',
        className,
      )}
      {...props}
    />
  );
}

function Input({ className, ...props }: React.ComponentProps<typeof Primitive.Input>) {
  return (
    <Primitive.Input
      data-slot="questionnaire-input"
      className={cn(
        'w-full rounded-lg border border-border bg-transparent p-2.5 text-[15px] text-neutral-950',
        'dark:text-neutral-100',
        className,
      )}
      {...props}
    />
  );
}

function Error({ className, ...props }: React.ComponentProps<typeof Primitive.Error>) {
  return (
    <Primitive.Error
      data-slot="questionnaire-error"
      className={cn('text-xs text-red-600 dark:text-red-400', className)}
      {...props}
    />
  );
}

function Previous({ className, ...props }: React.ComponentProps<typeof Primitive.Previous>) {
  return (
    <Primitive.Previous
      data-slot="questionnaire-previous"
      className={cn('rounded-lg px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400', className)}
      {...props}
    />
  );
}

function Next({ className, ...props }: React.ComponentProps<typeof Primitive.Next>) {
  return (
    <Primitive.Next
      data-slot="questionnaire-next"
      className={cn('rounded-lg px-3 py-2 text-sm font-semibold text-neutral-700 dark:text-neutral-200', className)}
      {...props}
    />
  );
}

function Submit({ className, ...props }: React.ComponentProps<typeof Primitive.Submit>) {
  return (
    <Primitive.Submit
      data-slot="questionnaire-submit"
      className={cn(
        'rounded-xl bg-brand px-[18px] py-[11px] text-[15px] font-semibold text-white disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export const Questionnaire = {
  Root,
  Progress,
  Item,
  Title,
  Description,
  Choices,
  Choice,
  ChoiceInput,
  ChoiceLabel,
  ChoiceShortcut,
  Input,
  Error,
  Previous,
  Next,
  Submit,
};
