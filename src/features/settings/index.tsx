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
import { Card, ScreenHeader, ScreenScaffold } from '../../components/ui/bits';
import { Switch } from '../../components/ui/switch';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import { Avatar, AvatarFallback } from '../../components/ui/avatar';
import { ConfirmDialog } from '../../components/ui/dialog';
import { UpdatePanel } from '../../components/ui/update-panel';
import { notificationsSupported } from '../../services/notifications';
import { brandColor, screenStyle } from '../../theme';
import { BUILD_ID } from '../../build';
import { writeClipboard } from '../../services/clipboard';
export function SettingsScreen() {
  const {
    authed,
    username,
    host,
    conn,
    activeProfile,
    logout,
    sessionInfo,
    applyApprovalMode,
    diagnostics,
    notificationsEnabled,
    setNotifications,
  } = useApp();
  const { theme, themeMode, setTheme, accent, setAccent } = useThemeValue();
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
      {/* No 'bottom' edge: the only bottom padding lives in the scroll content
        (safe area + 24). Keeping 'bottom' doubles the gap above the gesture
        bar on edge-to-edge Android. */}
      <ScreenScaffold header={<ScreenHeader title="Settings" />} contentClassName="px-4 py-4">
        <div className="mx-auto w-full max-w-4xl pb-[calc(env(safe-area-inset-bottom,0px)+24px)]">
            {/* Appearance Section */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Palette size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
                <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Appearance
                </div>
              </div>
              <Card>
                <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">Theme Mode</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-3.5">
                  Follow your device or choose a fixed theme
                </div>

                <div className="flex gap-2">
                  {/* Light Theme Card */}
                  <button
                    type="button"
                    aria-label="Light theme"
                    aria-pressed={themeMode === 'light'}
                    onClick={() => setTheme('light')}
                    className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                      themeMode === 'light'
                        ? 'border-amber-500 bg-amber-50 dark:bg-input/30'
                        : 'border-border bg-popover'
                    }`}>
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-amber-100 dark:bg-amber-950/60 mb-2">
                      <Sun size={18} color="#d97706" />
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        themeMode === 'light'
                          ? 'text-amber-700 font-bold dark:text-amber-300'
                          : 'text-neutral-700 dark:text-neutral-300'
                      }`}>
                      Light
                    </span>
                    {themeMode === 'light' && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <Check size={12} color="#b45309" />
                        <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">Active</div>
                      </div>
                    )}
                  </button>

                  {/* Dark Theme Card */}
                  <button
                    type="button"
                    aria-label="Dark theme"
                    aria-pressed={themeMode === 'dark'}
                    onClick={() => setTheme('dark')}
                    className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                      themeMode === 'dark'
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/50'
                        : 'border-border bg-popover'
                    }`}>
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-indigo-100 dark:bg-indigo-950/60 mb-2">
                      <Moon size={18} color="#6366f1" />
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        themeMode === 'dark'
                          ? 'text-indigo-700 font-bold dark:text-indigo-300'
                          : 'text-neutral-700 dark:text-neutral-300'
                      }`}>
                      Dark
                    </span>
                    {themeMode === 'dark' && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <Check size={12} color="#a5b4fc" />
                        <div className="text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">Active</div>
                      </div>
                    )}
                  </button>

                  {/* Follow the device appearance. */}
                  <button
                    type="button"
                    aria-label="System theme"
                    aria-pressed={themeMode === 'system'}
                    onClick={() => setTheme('system')}
                    className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                      themeMode === 'system'
                        ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/50'
                        : 'border-border bg-popover'
                    }`}>
                    <div className="flex flex-col mb-2 h-8 w-8 items-center justify-center rounded-full bg-sky-100 dark:bg-sky-950/60">
                      <Monitor size={18} color={dark ? '#38bdf8' : '#0284c7'} />
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        themeMode === 'system'
                          ? 'font-bold text-sky-700 dark:text-sky-300'
                          : 'text-neutral-700 dark:text-neutral-300'
                      }`}>
                      System
                    </span>
                    {themeMode === 'system' && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <Check size={12} color={dark ? '#7dd3fc' : '#0369a1'} />
                        <div className="text-[11px] font-semibold text-sky-700 dark:text-sky-300">Active</div>
                      </div>
                    )}
                  </button>
                </div>
              </Card>
              <Card>
                <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100 mb-1">Accent</div>
                <div className="text-xs text-neutral-500 dark:text-neutral-400 mb-3.5">
                  Hermes blue or OpenChamber warm ember
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label="Hermes accent"
                    aria-pressed={accent === 'default'}
                    onClick={() => setAccent('default')}
                    className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                      accent === 'default'
                        ? 'border-brand bg-brand/10'
                        : 'border-border bg-popover'
                    }`}>
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-brand mb-2">
                      <span className="text-sm font-bold text-white">H</span>
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        accent === 'default'
                          ? 'font-bold text-brand'
                          : 'text-neutral-700 dark:text-neutral-300'
                      }`}>
                      Hermes
                    </span>
                    {accent === 'default' && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <Check size={12} color="var(--brand-hex)" />
                        <div className="text-[11px] font-semibold text-brand">Active</div>
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label="OpenChamber accent"
                    aria-pressed={accent === 'openchamber'}
                    onClick={() => setAccent('openchamber')}
                    className={`flex-1 items-center justify-center rounded-xl border p-3.5 ${
                      accent === 'openchamber'
                        ? 'border-[#da7c47] bg-orange-50 dark:bg-orange-950/40'
                        : 'border-border bg-popover'
                    }`}>
                    <div className="flex items-center justify-center h-8 w-8 rounded-full bg-[#da7c47] mb-2">
                      <span className="text-sm font-bold text-white">O</span>
                    </div>
                    <span
                      className={`text-sm font-semibold ${
                        accent === 'openchamber'
                          ? 'font-bold text-[#b35017] dark:text-[#da7c47]'
                          : 'text-neutral-700 dark:text-neutral-300'
                      }`}>
                      Chamber
                    </span>
                    {accent === 'openchamber' && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <Check size={12} color={dark ? '#da7c47' : '#b35017'} />
                        <div className="text-[11px] font-semibold text-[#b35017] dark:text-[#da7c47]">Active</div>
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
                <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Agent
                </div>
              </div>
              <Card>
                <div className="mb-1 text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  Dangerous-command approvals
                </div>
                <div className="mb-3 text-xs text-neutral-500 dark:text-neutral-400">
                  How the agent handles shell commands flagged as risky
                </div>
                <div className="flex flex-col gap-2">
                  {APPROVALS.map((a) => {
                    const on = approvalMode === a.value;
                    return (
                      <button
                        type="button"
                        key={a.value}
                        data-testid={`approval-${a.value}`}

                        aria-pressed={on}
                        aria-label={a.label}
                        title={a.hint}
                        onClick={() => void applyApprovalMode(a.value)}
                        className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
                          on
                            ? 'border-brand bg-brand/10'
                            : 'border-border bg-popover'
                        }`}>
                        <div className="min-w-0 flex-1">
                          <div
                            className={`text-sm font-semibold ${
                              on ? 'text-brand' : 'text-neutral-800 dark:text-neutral-200'
                            }`}>
                            {a.label}
                          </div>
                          <div className="text-[11px] text-neutral-500 dark:text-neutral-400">{a.hint}</div>
                        </div>
                        {on && <Check size={15} color={brandColor(dark)} />}
                      </button>
                    );
                  })}
                </div>

                <Separator className="my-3 bg-border" />
                {[
                  ['Profile', typeof sessionInfo?.profile_name === 'string' ? sessionInfo.profile_name : ''],
                  ['Model', typeof sessionInfo?.model === 'string' ? sessionInfo.model : ''],
                  ['Provider', typeof sessionInfo?.provider === 'string' ? sessionInfo.provider : ''],
                  ['Working dir', typeof sessionInfo?.cwd === 'string' ? sessionInfo.cwd : ''],
                ].map(([label, value]) =>
                  value ? (
                    <div key={label} className="flex items-center justify-between gap-3 py-1">
                      <div className="text-xs text-neutral-600 dark:text-neutral-300">{label}</div>
                      <div className="shrink text-xs font-mono font-medium text-neutral-900 dark:text-neutral-100 truncate">
                        {value}
                      </div>
                    </div>
                  ) : null,
                )}

                {mcpServers.length > 0 && (
                  <>
                    <Separator className="my-2 bg-border" />
                    <div className="mb-1 text-xs font-semibold text-neutral-700 dark:text-neutral-300">MCP servers</div>
                    {mcpServers.map((s, i) => (
                      <div key={`${s?.name ?? i}`} className="flex items-center justify-between py-1">
                        <div className="text-xs text-neutral-600 dark:text-neutral-300 truncate">
                          {String(s?.name ?? 'server')}
                        </div>
                        <div className="text-[11px] text-neutral-500 dark:text-neutral-400">
                          {String(s?.status ?? '')}
                          {typeof s?.tool_count === 'number' ? ` · ${s.tool_count} tools` : ''}
                        </div>
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
                <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Hermes Update
                </div>
              </div>
              <UpdatePanel />
            </div>

            {/* Notifications Section */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Info size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
                <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Notifications
                </div>
              </div>
              <Card>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                      Background alerts
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                      Notify when a turn finishes or the agent needs input (approval, clarify), while the app is in the
                      background.
                      {!notificationsSupported() && ' Not supported in this browser.'}
                    </div>
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
                <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Account & Server
                </div>
              </div>
              <Card>
                {/* User row */}
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <div className="flex items-center gap-2.5">
                    <Avatar className="bg-brand">
                      <AvatarFallback className="bg-brand">
                        <span className="text-sm font-bold text-white">
                          {(username || 'H').slice(0, 1).toUpperCase()}
                        </span>
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                        {username || 'Hermes User'}
                      </div>
                      <div className="text-xs text-neutral-500 dark:text-neutral-400">Account</div>
                    </div>
                  </div>
                </div>

                {/* Active agent profile — switch from the Drawer. */}
                <div className="flex items-center justify-between border-b border-border py-2.5">
                  <div className="flex items-center gap-2">
                    <CircleUserRound size={15} color={dark ? '#aaa' : '#666'} />
                    <div className="text-xs text-neutral-600 dark:text-neutral-300">Agent Profile</div>
                  </div>
                  <div className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{activeProfile}</div>
                </div>

                {/* Host row */}
                <div className="flex items-center justify-between py-2.5 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Server size={15} color={dark ? '#aaa' : '#666'} />
                    <div className="text-xs text-neutral-600 dark:text-neutral-300">Server Host</div>
                  </div>
                  <div className="text-xs font-mono font-medium text-neutral-900 dark:text-neutral-100">
                    {host || 'Not connected'}
                  </div>
                </div>

                {/* Gateway status row */}
                <div className="flex items-center justify-between py-2.5">
                  <div className="flex items-center gap-2">
                    <Globe size={15} color={dark ? '#aaa' : '#666'} />
                    <div className="text-xs text-neutral-600 dark:text-neutral-300">Gateway Status</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div
                      className={`h-2 w-2 rounded-full ${
                        isReady ? 'bg-emerald-500' : isConnecting ? 'bg-amber-500' : 'bg-red-500'
                      }`}
                    />
                    <div
                      className={`text-xs font-medium ${
                        isReady
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isConnecting
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-red-500'
                      }`}>
                      {isReady ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
                    </div>
                  </div>
                </div>
              </Card>
            </div>

            {/* About / System Info */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <Info size={16} color={dark ? '#9aa0a6' : '#5f6368'} />
                <div className="text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  About
                </div>
              </div>
              <Card>
                <div className="flex items-center justify-between py-1 border-b border-border">
                  <div className="text-xs text-neutral-600 dark:text-neutral-300">Client</div>
                  <div className="text-xs font-medium text-neutral-900 dark:text-neutral-100">Hermes Mobile</div>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div className="text-xs text-neutral-600 dark:text-neutral-300">Build ID</div>
                  <div className="text-xs font-mono text-neutral-500 dark:text-neutral-400">{BUILD_ID}</div>
                </div>
                <div className="flex items-center justify-between py-1 border-t border-border">
                  <div className="text-xs text-neutral-600 dark:text-neutral-300">Last event</div>
                  <div className="text-xs font-mono text-neutral-500 dark:text-neutral-400">
                    {String(diag?.ws?.lastEvent ?? '—')}
                  </div>
                </div>
                <Button
                  variant="outline"
                  aria-label="Copy diagnostics"
                  onClick={() => void writeClipboard(JSON.stringify(diag, null, 2)).catch(() => {})}
                  className="mt-2 h-auto sm:h-auto w-full rounded-xl py-2.5">
                  <span className="text-[13px] font-semibold text-neutral-800 dark:text-neutral-200">
                    Copy diagnostics
                  </span>
                </Button>
              </Card>
            </div>

            {/* Log Out Action Button */}
            <Button
              variant="outline"
              onClick={handleLogout}
              aria-label="Log out"
              className="h-auto sm:h-auto w-full rounded-2xl border-red-200 bg-red-50/60 py-3.5 active:bg-red-100/80 dark:border-red-950 dark:bg-red-950/30 dark:active:bg-red-950/50">
              <LogOut size={16} color="#dc2626" />
              <span className="text-sm font-semibold text-red-600 dark:text-red-400">Log Out</span>
            </Button>
        </div>
      </ScreenScaffold>

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
