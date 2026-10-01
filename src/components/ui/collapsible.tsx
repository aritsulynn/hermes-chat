// Collapsible, on Base UI. Used by the sidebar's nested nav (the "More" submenu)
// to open and close its children, and to drive the chevron that says whether
// they are open.
//
// Base UI exposes open state as a `data-open` attribute rather than a class, so
// the rotating chevron is written `group-data-open/collapsible:rotate-90` — the
// `group/collapsible` on the root is what that variant is relative to.
import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />;
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent };
