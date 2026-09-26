// Tailwind class merge helper used by the reusables (shadcn-style) components.
// Registered as the `utils` alias in components.json, so the CLI rewrites the
// generated `cn` imports to this path.
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
