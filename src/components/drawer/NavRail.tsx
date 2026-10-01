// Collapsed sidebar: a narrow icon rail, like ChatGPT / VS Code. The primary
// destinations stay one click away while the full panel is hidden, instead of
// the whole drawer disappearing.
import { useLocation } from 'react-router-dom';
import { PanelLeft, Settings, SquarePen } from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { navigate } from '../../store/nav';
import { Button } from '../ui/button';
import { Avatar, AvatarFallback } from '../ui/avatar';
import { MORE_NAV_ITEMS, NAV_ITEMS, PROFILE_NAV_ITEMS } from './nav-config';
import { brandColor, screenBg } from '../../theme';

/** Every destination the full drawer exposes, in the same order. */
const RAIL_ITEMS = [...NAV_ITEMS, ...MORE_NAV_ITEMS, ...PROFILE_NAV_ITEMS];

export function NavRail({ onExpand }: { onExpand: () => void }) {
  const { pathname } = useLocation();
  const { theme } = useThemeValue();
  const { username, busy, newSession } = useApp();
  const dark = theme === 'dark';
  const brand = brandColor(dark);
  const dim = dark ? '#a3a3a3' : '#555';
  const activeClass = 'rounded-xl bg-[#e8e8ec] dark:bg-[#272727]';

  return (
    <div
      data-testid="nav-rail"
      className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-neutral-200 py-2 dark:border-neutral-800"
      style={{ background: screenBg(dark) }}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Expand navigation"
        title="Expand navigation"
        onClick={onExpand}
        className="mb-1">
        <PanelLeft size={20} color={dim} />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        aria-label="New chat"
        title="New chat"
        disabled={busy}
        onClick={() => {
          if (busy) return;
          void newSession();
          navigate('/chat');
        }}
        className={pathname === '/chat' ? activeClass : ''}>
        <SquarePen size={20} color={pathname === '/chat' ? brand : dim} />
      </Button>

      {RAIL_ITEMS.map((item) => {
        const active = pathname === `/${item.name}`;
        const Icon = item.icon;
        return (
          <Button
            key={item.name}
            variant="ghost"
            size="icon"
            aria-label={item.label}
            title={item.label}
            onClick={() => navigate(`/${item.name}`)}
            className={active ? activeClass : ''}>
            <Icon size={20} color={active ? brand : dim} />
          </Button>
        );
      })}

      <div className="flex-1" />

      <Button
        variant="ghost"
        size="icon"
        aria-label="Settings"
        title="Settings"
        onClick={() => navigate('/settings')}
        className={pathname === '/settings' ? activeClass : ''}>
        <Settings size={20} color={pathname === '/settings' ? brand : dim} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Account"
        title={username || 'Account'}
        onClick={() => navigate('/settings')}
        className="rounded-full">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="bg-blue-600 text-xs font-bold text-white">
            {(username || 'H').slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </Button>
    </div>
  );
}
