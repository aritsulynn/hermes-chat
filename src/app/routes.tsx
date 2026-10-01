// Route table.
//
// expo-router derived this from the files in src/app/*, so each of those is a
// thin re-export of a screen in src/features. React Router needs the mapping
// declared, but the per-screen files stay exactly as they were — a route stays
// a 4-line file that names one screen, and the feature folder keeps owning all
// the logic.
//
// `path` is the URL; `name` is the drawer key. They are the same string for
// every screen here, which is why NAV_ITEMS in the drawer can navigate with a
// bare `/` + name.
import ChatRoute from './chat';
import LoginRoute from './login';
import Index from './index';
import AsksRoute from './asks';
import CronRoute from './cron';
import FilesRoute from './files';
import KanbanRoute from './kanban';
import LogsRoute from './logs';
import SettingsRoute from './settings';
import SkillsRoute from './skills';
import ToolsetsRoute from './toolsets';
import UsageRoute from './usage';

export const ROUTES = [
  { path: '/', element: <Index /> },
  { path: '/login', element: <LoginRoute /> },
  { path: '/chat', element: <ChatRoute /> },
  { path: '/asks', element: <AsksRoute /> },
  { path: '/cron', element: <CronRoute /> },
  { path: '/files', element: <FilesRoute /> },
  { path: '/kanban', element: <KanbanRoute /> },
  { path: '/logs', element: <LogsRoute /> },
  { path: '/settings', element: <SettingsRoute /> },
  { path: '/skills', element: <SkillsRoute /> },
  { path: '/toolsets', element: <ToolsetsRoute /> },
  { path: '/usage', element: <UsageRoute /> },
] as const;

/**
 * Any unknown URL goes to chat rather than to a 404. The store owns auth: an
 * unauthenticated visitor is bounced to /login by the login screen's own
 * effect, and every screen guards itself, so the fallback only has to not be a
 * dead end.
 */
export const FALLBACK_PATH = '/chat';
