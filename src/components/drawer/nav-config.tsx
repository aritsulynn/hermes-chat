// Drawer navigation config + icon helper, shared by the drawer content and the
// route table in routes.tsx.
import { Activity, BellRing, Bot, Boxes, Clock, Cpu, Folder, Kanban, KeyRound, Link2, MessageCircle, Package, Plug, ScrollText, Server, Settings2, Store, Wrench, Zap } from 'lucide-react';

// Module-level icon helper — used by the route table and the drawer content.
export const drawerIcon =
  (C: any) =>
  ({ color, size }: any) => <C size={size} color={color} />;

export const NAV_ITEMS = [
  { name: 'cron', label: 'Cron Jobs', icon: Clock },
  { name: 'files', label: 'Files', icon: Folder },
] as const;

export const MORE_NAV_ITEMS = [
  { name: 'kanban', label: 'Kanban', icon: Kanban },
  { name: 'asks', label: 'Ask Inbox', icon: BellRing },
  { name: 'skills', label: 'Skills', icon: Wrench },
  { name: 'skills-hub', label: 'Skills Hub', icon: Store },
  { name: 'toolsets', label: 'Toolsets', icon: Boxes },
  { name: 'mcp', label: 'MCP', icon: Plug },
  { name: 'pairing', label: 'Pairing', icon: Link2 },
  { name: 'webhooks', label: 'Webhooks', icon: Zap },
  { name: 'system', label: 'System', icon: Server },
  { name: 'channels', label: 'Channels', icon: MessageCircle },
  { name: 'profiles', label: 'Profiles', icon: Bot },
  { name: 'plugins', label: 'Plugins', icon: Package },
  { name: 'keys', label: 'Keys', icon: KeyRound },
  { name: 'config', label: 'Config', icon: Settings2 },
  { name: 'models', label: 'Models', icon: Cpu },
] as const;

// Items shown inside the profile bar popover (above Settings / Log Out)
export const PROFILE_NAV_ITEMS = [
  { name: 'logs', label: 'Logs', icon: ScrollText },
  { name: 'usage', label: 'Usage', icon: Activity },
] as const;
