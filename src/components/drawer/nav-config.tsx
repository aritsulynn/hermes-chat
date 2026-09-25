// Drawer navigation config + icon helper, shared by the custom drawer content
// and the Drawer.Screen options in app/_layout.tsx.
import { Activity, BellRing, Boxes, Clock, Folder, Kanban, ScrollText, Wrench } from 'lucide-react-native';

// Module-level icon helper — used both in drawer content and screen options.
export const drawerIcon = (C: any) => ({ color, size }: any) => <C size={size} color={color} />;

export const NAV_ITEMS = [
  { name: 'cron', label: 'Cron Jobs', icon: Clock },
  { name: 'files', label: 'Files', icon: Folder },
] as const;

export const MORE_NAV_ITEMS = [
  { name: 'kanban', label: 'Kanban', icon: Kanban },
  { name: 'asks', label: 'Ask Inbox', icon: BellRing },
  { name: 'skills', label: 'Skills', icon: Wrench },
  { name: 'toolsets', label: 'Toolsets', icon: Boxes },
] as const;

// Items shown inside the profile bar popover (above Settings / Log Out)
export const PROFILE_NAV_ITEMS = [
  { name: 'logs', label: 'Logs', icon: ScrollText },
  { name: 'usage', label: 'Usage', icon: Activity },
] as const;
