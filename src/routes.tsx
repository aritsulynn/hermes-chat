import { AskInboxScreen } from './features/asks';
import { ChatScreen } from './features/chat';
import { CronScreen } from './features/cron';
import { FilesScreen } from './features/files';
import { KanbanScreen } from './features/kanban';
import { LogsScreen } from './features/logs';
import { McpScreen } from './features/mcp';
import { SettingsScreen } from './features/settings';
import { SkillsScreen } from './features/skills';
import { SkillsHubScreen } from './features/skills-hub';
import { ToolsetsScreen } from './features/toolsets';
import { UsageScreen } from './features/usage';

/**
 * The in-app route table. Each screen lives in `src/features/<name>`; this file
 * only maps a URL to it. `path` doubles as the drawer key, so the drawer
 * navigates with a bare `/` + name. `/login` is not here — auth screens render
 * outside the app shell (see App.tsx).
 */
export const APP_ROUTES = [
  { path: '/chat', element: <ChatScreen /> },
  { path: '/asks', element: <AskInboxScreen /> },
  { path: '/cron', element: <CronScreen /> },
  { path: '/files', element: <FilesScreen /> },
  { path: '/kanban', element: <KanbanScreen /> },
  { path: '/logs', element: <LogsScreen /> },
  { path: '/mcp', element: <McpScreen /> },
  { path: '/settings', element: <SettingsScreen /> },
  { path: '/skills', element: <SkillsScreen /> },
  { path: '/skills-hub', element: <SkillsHubScreen /> },
  { path: '/toolsets', element: <ToolsetsScreen /> },
  { path: '/usage', element: <UsageScreen /> },
] as const;

/** Unknown URLs fall back here rather than 404; the screens guard their own auth. */
export const FALLBACK_PATH = '/chat';
