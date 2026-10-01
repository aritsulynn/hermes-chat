import { cn } from '@/utils/cn';
import type { LucideIcon, LucideProps } from 'lucide-react';
import * as React from 'react';

type IconProps = LucideProps & {
  as: LucideIcon;
} & React.RefAttributes<SVGSVGElement>;

/**
 * A wrapper component for Lucide icons so they take Tailwind classes directly.
 *
 * The native build needed `nativewind`'s `cssInterop` here, because a Lucide
 * icon renders an `<Svg>` and the `size`/`width`/`height` props had to be
 * redirected into React Native style props. On web a Lucide icon is already a
 * plain `<svg>`, so `className` reaches the element untouched and the interop
 * layer — along with its `nativeStyleToProp` remapping — is gone.
 *
 * `text-foreground` is applied by default so an icon matches its surrounding
 * text, and an explicit `text-*` in `className` overrides it.
 */
function Icon({ as: IconComponent, className, size = 14, ...props }: IconProps) {
  return <IconComponent className={cn('text-foreground', className)} size={size} {...props} />;
}

export { Icon };
export type { IconProps };
