import { useCallback, useState } from 'react';
import { Navigate as Redirect } from 'react-router-dom';
import {
  Check,
  CircleUserRound,
  Download,
  Globe,
  Info,
  LogOut,
  Monitor,
  Moon,
  Palette,
  Server,
  Shield,
  Sun,
  User,
} from 'lucide-react';
import { useApp, useThemeValue } from '../../hooks/app-store';
import { Card, ScreenHeader } from '../../components/ui/bits';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { Text as UIText } from '../../components/ui/text';
import { ConfirmDialog } from '../../components/ui/dialog';
import { UpdatePanel } from '../../components/ui/update-panel';
import { notificationsSupported } from '../../services/notifications';
import { brandColor, screenStyle } from '../../theme';
import { BUILD_ID } from '../../build';
import { ScrollArea } from '../../components/ui/scroll';
import { writeClipboard } from '../../services/clipboard';
export function SettingsScreen() {
  const { authed, username, host, conn, activeProfile, logout, sessionInfo, applyApprovalMode, diagnostics, notificationsEnabled, setNotifications } = useApp();
  const { theme, themeMode, setTheme } = useThemeValue();
  const dark = theme === 'dark';
  const isReady = conn === 'ready';
  const isConnecting = conn === 'connecting' || conn === 'reconnecting';
  const diag = diagnostics() as any;
  const approvalMode = typeof sessionInfo?.approval_mode === 'string' ? sessionInfo.approval_mode : '';
  const mcpServers: any[] = Array.isArray(sessionInfo?.mcp_servers) ? sessionInfo.mcp_servers : [];
  const APPROVALS: { value: 'manual' | 'smart' | 'off'; label: string; hint: string }[] = [
    { value: 'manual', label: 'Manual', hint: 'Ask before every dangerous command' },
    { value: 'smart', label: 'Smart', hint: 'Model decides when to ask' },
    { value: 'off', label: 'Off (YOLO)', hint: 'Never ask — run everything' },
  ];

  const [confirmLogout, setConfirmLogout] = useState(false);

  const handleLogout = useCallback(() => {
    setConfirmLogout(true);
  }, []);

  if (!authed) return <Redirect to="/login" replace />;

  return (
    <div style={screenStyle(dark)}>
    {/* No 'bottom' edge: the only bottom padding lives in the ScrollView
        content (insets.bottom + 24). Keeping 'bottom' doubles the gap
        above the gesture bar on edge-to-edge Android. */}
    <div className="flex-1 bg-white dark:bg-black">
      

      {/* Header */}
      <ScreenHeader title="Settings" />

      <ScrollArea
        className="flex-1 px-4 py-4"
        contentClassName="pb-[calc(env(safe-area-inset-bottom,0px)+24px)]"
>
        {/* Appearance Section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Palette size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <UIText className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Appearance
            </UIText>
          </div>
          <Card>
            <UIText className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">
              Theme Mode
            </UIText>
            <UIText className="text-xs text-neutral-500 dark:text-neutral-400 mb-3.5">
              Follow your device or choose a fixed theme
            </UIText>

            <div className="flex gap-2">
              {/* Light Theme Card */}
              <button type="button"
                role="button"
                aria-label="Light theme"
                aria-pressed={themeMode === 'light'}
                onClick={() => setTheme('light')}
                className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                  themeMode === 'light'
                    ? 'border-amber-500 bg-amber-50 dark:bg-neutral-950'
                    : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                }`}
>
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-950/60 mb-2">
                  <Sun size={18} color="#d97706" />
                </div>
                <UIText
                  className={`text-sm font-semibold ${
                    themeMode === 'light' ? 'text-amber-700 font-bold dark:text-amber-300' : 'text-neutral-700 dark:text-neutral-300'
                  }`}
>
                  Light
                </UIText>
                {themeMode === 'light' && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <Check size={12} color="#b45309" />
                    <UIText className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Active</UIText>
                  </div>
                )}
              </button>

              {/* Dark Theme Card */}
              <button type="button"
                role="button"
                aria-label="Dark theme"
                aria-pressed={themeMode === 'dark'}
                onClick={() => setTheme('dark')}
                className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                  themeMode === 'dark'
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50'
                    : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                }`}
>
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-950/60 mb-2">
                  <Moon size={18} color="#6366f1" />
                </div>
                <UIText
                  className={`text-sm font-semibold ${
                    themeMode === 'dark' ? 'text-indigo-700 font-bold dark:text-indigo-300' : 'text-neutral-700 dark:text-neutral-300'
                  }`}
>
                  Dark
                </UIText>
                {themeMode === 'dark' && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <Check size={12} color="#a5b4fc" />
                    <UIText className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">Active</UIText>
                  </div>
                )}
              </button>

              {/* Follow the device appearance. */}
              <button type="button"
                role="button"
                aria-label="System theme"
                aria-pressed={themeMode === 'system'}
                onClick={() => setTheme('system')}
                className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                  themeMode === 'system'
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/50'
                    : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                }`}
>
                <div className="mb-2 h-8 w-8 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-950/60">
                  <Monitor size={18} color={dark ? '#38bdf8' : '#0284c7'} />
                </div>
                <UIText
                  className={`text-sm font-semibold ${
                    themeMode === 'system'
                      ? 'font-bold text-sky-700 dark:text-sky-300'
                      : 'text-neutral-700 dark:text-neutral-300'
                  }`}
>
                  System
                </UIText>
                {themeMode === 'system' && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <Check size={12} color={dark ? '#7dd3fc' : '#0369a1'} />
                    <UIText className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">Active</UIText>
                  </div>
                )}
              </button>
            </div>
          </Card>
        </div>

        {/* Agent / runtime Section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Shield size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <UIText className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Agent
            </UIText>
          </div>
          <Card>
            <UIText className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              Dangerous-command approvals
            </UIText>
            <UIText className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
              How the agent handles shell commands flagged as risky
            </UIText>
            <div className="gap-2">
              {APPROVALS.map((a) => {
                const on = approvalMode === a.value;
                return (
                  <button type="button"
                    key={a.value}
                    data-testid={`approval-${a.value}`}

                    aria-pressed={on}
                    aria-label={a.label}
                    title={a.hint}
                    onClick={() => void applyApprovalMode(a.value)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
                      on
                        ? 'border-[#1a73e8] bg-blue-50/70 dark:bg-blue-950/40'
                        : 'border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950'
                    }`}
>
                    <div className="min-w-0 flex-1">
                      <UIText
                        className={`text-sm font-semibold ${
                          on ? 'text-[#1a73e8] dark:text-[#7aa7ff]' : 'text-neutral-800 dark:text-neutral-200'
                        }`}
>
                        {a.label}
                      </UIText>
                      <UIText className="text-[11px] text-neutral-500 dark:text-neutral-400">{a.hint}</UIText>
                    </div>
                    {on && <Check size={15} color={brandColor(dark)} />}
                  </button>
                );
              })}
            </div>

            <Separator className="my-3 bg-neutral-200 dark:bg-neutral-800" />
            {[
              ['Profile', typeof sessionInfo?.profile_name === 'string' ? sessionInfo.profile_name : ''],
              ['Model', typeof sessionInfo?.model === 'string' ? sessionInfo.model : ''],
              ['Provider', typeof sessionInfo?.provider === 'string' ? sessionInfo.provider : ''],
              ['Working dir', typeof sessionInfo?.cwd === 'string' ? sessionInfo.cwd : ''],
            ].map(([label, value]) =>
              value ? (
                <div key={label} className="flex items-center justify-between gap-3 py-1">
                  <UIText className="text-xs text-neutral-600 dark:text-neutral-300">{label}</UIText>
                  <UIText
                    className="shrink text-xs font-mono font-medium text-neutral-900 dark:text-neutral-100"
                    numberOfLines={1}
>
                    {value}
                  </UIText>
                </div>
              ) : null,
            )}

            {mcpServers.length> 0 && (
              <>
                <Separator className="my-2 bg-neutral-200 dark:bg-neutral-800" />
                <UIText className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  MCP servers
                </UIText>
                {mcpServers.map((s, i) => (
                  <div key={`${s?.name ?? i}`} className="flex items-center justify-between py-1">
                    <UIText className="text-xs text-neutral-600 dark:text-neutral-300" numberOfLines={1}>
                      {String(s?.name ?? 'server')}
                    </UIText>
                    <UIText className="text-[11px] text-neutral-500 dark:text-neutral-400">
                      {String(s?.status ?? '')}
                      {typeof s?.tool_count === 'number' ? ` · ${s.tool_count} tools` : ''}
                    </UIText>
                  </div>
                ))}
              </>
            )}
          </Card>
        </div>

        {/* Hermes Update Section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Download size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <UIText className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Hermes Update
            </UIText>
          </div>
          <UpdatePanel />
        </div>

        {/* Notifications Section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Info size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <UIText className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Notifications
            </UIText>
          </div>
          <Card>
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <UIText className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  Background alerts
                </UIText>
                <UIText className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                  Notify when a turn finishes or the agent needs input (approval, clarify), while the
                  app is in the background.
                  {!notificationsSupported() && ' Requires a development build — not available in Expo Go.'}
                </UIText>
              </div>
              <Switch
                aria-label="Background notifications"
                checked={notificationsEnabled}
                onCheckedChange={(v) => void setNotifications(v)}
              />
            </div>
          </Card>
        </div>

        {/* Account & Server Section */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <User size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <UIText className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Account & Server
            </UIText>
          </div>
          <Card>
            {/* User row */}
            <div className="flex items-center justify-between py-2 border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-2.5">
                <Avatar className="bg-[#1a73e8]">
                  <AvatarFallback className="bg-[#1a73e8]">
                    <UIText className="text-sm font-bold text-white">
                      {(username || 'H').slice(0, 1).toUpperCase()}
                    </UIText>
                  </AvatarFallback>
                </Avatar>
                <div>
                  <UIText className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                    {username || 'Hermes User'}
                  </UIText>
                  <UIText className="text-xs text-neutral-500 dark:text-neutral-400">
                    Account
                  </UIText>
                </div>
              </div>
            </div>

            {/* Active agent profile — switch from the Drawer. */}
            <div className="flex items-center justify-between border-b border-neutral-200 py-2.5 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <CircleUserRound size={15} color={dark ? '#aaa' : '#666'} />
                <UIText className="text-xs text-neutral-600 dark:text-neutral-300">Agent Profile</UIText>
              </div>
              <UIText className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{activeProfile}</UIText>
            </div>

            {/* Host row */}
            <div className="flex items-center justify-between py-2.5 border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-2">
                <Server size={15} color={dark ? '#aaa' : '#666'} />
                <UIText className="text-xs text-neutral-600 dark:text-neutral-300">Server Host</UIText>
              </div>
              <UIText className="text-xs font-mono font-medium text-neutral-900 dark:text-neutral-100">
                {host || 'Not connected'}
              </UIText>
            </div>

            {/* Gateway status row */}
            <div className="flex items-center justify-between py-2.5">
              <div className="flex items-center gap-2">
                <Globe size={15} color={dark ? '#aaa' : '#666'} />
                <UIText className="text-xs text-neutral-600 dark:text-neutral-300">Gateway Status</UIText>
              </div>
              <div className="flex items-center gap-1.5">
                <div
                  className={`h-2 w-2 rounded-full ${
                    isReady ? 'bg-emerald-500' : isConnecting ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                />
                <UIText
                  className={`text-xs font-medium ${
                    isReady
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : isConnecting
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-500'
                  }`}
>
                  {isReady ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
                </UIText>
              </div>
            </div>
          </Card>
        </div>

        {/* About / System Info */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Info size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
            <UIText className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              About
            </UIText>
          </div>
          <Card>
            <div className="flex items-center justify-between py-1 border-b border-neutral-200 dark:border-neutral-800">
              <UIText className="text-xs text-neutral-600 dark:text-neutral-300">Client</UIText>
              <UIText className="text-xs font-medium text-neutral-900 dark:text-neutral-100">
                Hermes Mobile
              </UIText>
            </div>
            <div className="flex items-center justify-between py-2">
              <UIText className="text-xs text-neutral-600 dark:text-neutral-300">Build ID</UIText>
              <UIText className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                {BUILD_ID}
              </UIText>
            </div>
            <div className="flex items-center justify-between py-1 border-t border-neutral-200 dark:border-neutral-800">
              <UIText className="text-xs text-neutral-600 dark:text-neutral-300">Last event</UIText>
              <UIText className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                {String(diag?.ws?.lastEvent ?? '—')}
              </UIText>
            </div>
            <Button
              variant="outline"
              aria-label="Copy diagnostics"
              onClick={() =>
                void writeClipboard(JSON.stringify(diag, null, 2)).catch(() => {})
              }
              className="mt-2 h-auto w-full rounded-xl py-2.5"
>
              <UIText className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">
                Copy diagnostics
              </UIText>
            </Button>
          </Card>

        </div>

        {/* Log Out Action Button */}
        <Button
          variant="outline"
          onClick={handleLogout}
          aria-label="Log out"
          className="h-auto w-full rounded-2xl border-red-200 bg-red-50/60 py-3.5 active:bg-red-100/80 dark:border-red-950 dark:bg-red-950/30 dark:active:bg-red-950/50"
>
          <LogOut size={16} color="#dc2626" />
          <UIText className="text-sm font-semibold text-red-600 dark:text-red-400">
            Log Out
          </UIText>
        </Button>
      </ScrollArea>
    </div>

      <ConfirmDialog
        open={confirmLogout}
        title="Log Out"
        description="Are you sure you want to log out of Hermes?"
        confirmLabel="Log Out"
        destructive
        onConfirm={() => void logout()}
        onOpenChange={setConfirmLogout}
      />
    </div>
  );
}
