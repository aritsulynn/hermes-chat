import { useEffect } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useNavigation } from 'expo-router';
import {
  AlertCircle,
  BellRing,
  Check,
  ChevronRight,
  Clock3,
  MessageCircleQuestion,
  ShieldAlert,
  X,
} from 'lucide-react-native';

import { HamburgerBtn } from '../../components/ui/bits';
import { Badge } from '../../components/ui/badge';
import { Alert as UIAlert, AlertDescription } from '../../components/ui/alert';
import { Text as UIText } from '../../components/ui/text';
import { useApp } from '../../hooks/app-store';
import type { AskInboxEntry } from '../../services/ask-inbox';
import { errMsg } from '../../utils/messages';

function methodLabel(method: string): string {
  if (method === 'approval') return 'Command approval';
  if (method === 'clarify') return 'Clarification';
  if (method === 'sudo') return 'Sudo password';
  if (method === 'secret') return 'Secret required';
  if (method.startsWith('vault.')) return 'Vault request';
  return method || 'Hermes request';
}

function requestSummary(entry: AskInboxEntry): string {
  const p = entry.params as Record<string, any>;
  if (entry.method === 'approval') {
    return String(
      p.description || p.command || 'A command is waiting for approval.',
    );
  }
  if (entry.method === 'clarify') {
    const question =
      p.question ||
      (Array.isArray(p.questions) ? p.questions[0]?.question : '');
    return String(question || 'Hermes needs an answer.');
  }
  if (entry.method === 'sudo')
    return String(p.command || 'Hermes needs your sudo password.');
  if (entry.method === 'secret')
    return String(p.prompt || p.env_var || 'Hermes needs a secret.');
  if (entry.method.startsWith('vault.')) {
    return String(p.display_name || p.site || 'Hermes needs vault access.');
  }
  return 'Hermes is waiting for input.';
}

function AskCard({
  entry,
  onApproval,
  onOpen,
}: {
  entry: AskInboxEntry;
  onApproval: (key: string, choice: string) => void;
  onOpen: (entry: AskInboxEntry) => void;
}) {
  const pending = entry.status === 'pending' || entry.status === 'answering';
  const waiting = pending || entry.status === 'sent';
  const ownerLabel = entry.owner.resolved
    ? `${entry.owner.profile || 'default'} · ${entry.owner.storedSessionId || 'session'}`
    : `session ${entry.sessionId || entry.owner.runtimeSessionId || 'unknown'}`;
  const Icon =
    entry.method === 'approval'
      ? ShieldAlert
      : entry.method === 'clarify'
        ? MessageCircleQuestion
        : AlertCircle;
  const iconColor = entry.method === 'approval' ? '#d97706' : '#2563eb';
  const approvalChoices = Array.isArray(entry.params.choices)
    ? entry.params.choices.map(String)
    : [];
  const canAllow =
    approvalChoices.length === 0 || approvalChoices.includes('once');
  const canDeny =
    approvalChoices.length === 0 || approvalChoices.includes('deny');

  return (
    <View className="rounded-2xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950">
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-950/40">
          <Icon size={18} color={iconColor} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-bold text-neutral-950 dark:text-neutral-100">
            {methodLabel(entry.method)}
          </Text>
          <Text
            className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400"
            numberOfLines={1}
          >
            {ownerLabel}
          </Text>
        </View>
        {waiting ? (
          <Badge variant="secondary" className="border-transparent py-1">
            <UIText className="text-[10px] font-bold uppercase text-amber-700 dark:text-amber-300">
              {entry.status === 'sent' ? 'Sent' : 'Waiting'}
            </UIText>
          </Badge>
        ) : (
          <Badge variant="secondary" className="border-transparent py-1">
            <UIText className="text-[10px] font-bold uppercase text-neutral-500 dark:text-neutral-400">
              {entry.status}
            </UIText>
          </Badge>
        )}
      </View>

      <Text className="mt-3 text-sm leading-5 text-neutral-700 dark:text-neutral-200">
        {requestSummary(entry)}
      </Text>

      {entry.method === 'approval' && !!entry.params.command && (
        <View className="mt-2 rounded-xl bg-neutral-100 p-2.5 dark:bg-neutral-900">
          <Text
            selectable
            numberOfLines={3}
            className="font-mono text-xs text-neutral-800 dark:text-neutral-200"
          >
            {String(entry.params.command)}
          </Text>
        </View>
      )}

      {pending && (
        <View className="mt-3 flex-row flex-wrap gap-2">
          {entry.method === 'approval' && (canAllow || canDeny) ? (
            <>
              {canAllow && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Allow once"
                  onPress={() => onApproval(entry.key, 'once')}
                  className="flex-1 items-center rounded-xl bg-[#1a73e8] px-3 py-2.5"
                >
                  <Text className="text-sm font-semibold text-white">
                    Allow once
                  </Text>
                </Pressable>
              )}
              {canDeny && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Reject request"
                  onPress={() => onApproval(entry.key, 'deny')}
                  className="flex-1 items-center rounded-xl border border-red-200 px-3 py-2.5 dark:border-red-950"
                >
                  <Text className="text-sm font-semibold text-red-600 dark:text-red-400">
                    Reject
                  </Text>
                </Pressable>
              )}
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open request"
              onPress={() => onOpen(entry)}
              className="flex-row items-center justify-center gap-1 rounded-xl bg-[#1a73e8] px-3 py-2.5"
            >
              <Text className="text-sm font-semibold text-white">
                Open request
              </Text>
              <ChevronRight size={15} color="#fff" />
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

export function AskInboxScreen() {
  const {
    authed,
    askInbox,
    pendingAskCount,
    error,
    theme,
    answerInboxApproval,
    openAskEntry,
  } = useApp();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const dark = theme === 'dark';

  useEffect(() => {
    (navigation as any).setOptions?.({
      headerLeft: () => <HamburgerBtn />,
      headerTintColor: dark ? '#f5f5f5' : '#111',
      title: 'Ask Inbox',
    });
  }, [navigation, dark]);

  const pending = askInbox.filter(
    (entry) =>
      entry.status === 'pending' ||
      entry.status === 'answering' ||
      entry.status === 'sent',
  );
  const settled = askInbox.filter(
    (entry) =>
      entry.status !== 'pending' &&
      entry.status !== 'answering' &&
      entry.status !== 'sent',
  );

  if (!authed) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-white dark:bg-black">
        <Text className="text-neutral-500 dark:text-neutral-400">
          Sign in to view asks.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: dark ? '#000' : '#fff' }}>
      <StatusBar style="auto" />
      <SafeAreaView
        className="flex-1 bg-white dark:bg-black"
        edges={['top', 'left', 'right', 'bottom']}
      >
        <View className="flex-row items-center gap-3 border-b border-neutral-200 px-4 py-4 dark:border-neutral-800">
          <HamburgerBtn />
          <Text className="text-xl font-bold text-neutral-950 dark:text-neutral-100">
            Ask Inbox
          </Text>
        </View>
        <ScrollView
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24,
            gap: 12,
          }}
          keyboardShouldPersistTaps="handled"
        >
          {!!error && (
            <UIAlert icon={AlertCircle} variant="destructive">
              <AlertDescription className="text-red-700 dark:text-red-300">{error}</AlertDescription>
            </UIAlert>
          )}
          <View className="mb-1 flex-row items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 dark:border-blue-950/50 dark:bg-blue-950/20">
            <BellRing size={21} color={dark ? '#93c5fd' : '#2563eb'} />
            <View className="flex-1">
              <Text className="text-sm font-bold text-neutral-950 dark:text-neutral-100">
                {pendingAskCount
                  ? `${pendingAskCount} request${pendingAskCount === 1 ? '' : 's'} waiting`
                  : 'No pending requests'}
              </Text>
              <Text className="mt-0.5 text-xs leading-4 text-neutral-600 dark:text-neutral-300">
                Approval actions are sent only to the gateway request that owns
                this item.
              </Text>
            </View>
          </View>

          {pending.map((entry) => (
            <AskCard
              key={entry.key}
              entry={entry}
              onApproval={(key, choice) => {
                try {
                  if (!answerInboxApproval(key, choice)) {
                    Alert.alert(
                      'Could not answer',
                      'The gateway is not ready or the request is no longer pending.',
                    );
                  }
                } catch (e) {
                  Alert.alert('Could not answer', errMsg(e));
                }
              }}
              onOpen={(entry) => void openAskEntry(entry)}
            />
          ))}

          {pending.length === 0 && (
            <View className="items-center rounded-2xl border border-dashed border-neutral-300 px-6 py-12 dark:border-neutral-700">
              <Check size={28} color={dark ? '#86efac' : '#16a34a'} />
              <Text className="mt-3 text-base font-semibold text-neutral-800 dark:text-neutral-200">
                You are all caught up
              </Text>
              <Text className="mt-1 text-center text-sm text-neutral-500 dark:text-neutral-400">
                Approval and clarification requests from background sessions
                will appear here.
              </Text>
            </View>
          )}

          {settled.length > 0 && (
            <View className="mt-4 gap-2">
              <Text className="px-1 text-xs font-bold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Recent
              </Text>
              {settled.slice(0, 10).map((entry) => (
                <View
                  key={entry.key}
                  className="flex-row items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2.5 dark:border-neutral-800"
                >
                  {entry.status === 'answered' ? (
                    <Check size={15} color="#16a34a" />
                  ) : (
                    <X size={15} color="#94a3b8" />
                  )}
                  <Text
                    className="flex-1 text-sm text-neutral-700 dark:text-neutral-300"
                    numberOfLines={1}
                  >
                    {methodLabel(entry.method)}
                  </Text>
                  <Text className="text-[11px] text-neutral-400">
                    {entry.status}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <View className="mt-2 flex-row items-center gap-2 px-1 text-xs text-neutral-400 dark:text-neutral-500">
            <Clock3 size={13} />
            <Text>
              Requests are kept until answered, cancelled, or the session is
              closed.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
