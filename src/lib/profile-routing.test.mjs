import assert from 'node:assert/strict';
import test from 'node:test';

import { GatewayWs } from './gateway-ws.ts';
import { getToolsets, setToolsetEnabled } from './toolsets.ts';

test('store-selection gateway calls carry the selected profile', async () => {
  const calls = [];
  const gateway = new GatewayWs({ wsUrl: 'ws://unused', events: {} });
  gateway.call = async (method, params) => {
    calls.push({ method, params });
    if (method === 'session.list') {
      return { sessions: [{ id: 'same-id', title: 'Work', message_count: 1 }] };
    }
    if (method === 'session.most_recent') return { session_id: 'same-id' };
    if (method === 'session.create') {
      return { session_id: 'runtime-new', stored_session_id: 'same-id' };
    }
    return {};
  };

  const [sessions, recent, created] = await Promise.all([
    gateway.listSessions(50, 'work'),
    gateway.mostRecent('work'),
    gateway.createSession({ model: 'model-x' }, 'work'),
  ]);
  await gateway.resume('same-id', 'work', true);
  await gateway.deleteSession('same-id', 'work');

  assert.equal(sessions[0].profile, 'work');
  assert.equal(recent, 'same-id');
  assert.equal(created.storedSessionId, 'same-id');
  assert.deepEqual(calls, [
    { method: 'session.list', params: { limit: 50, profile: 'work' } },
    { method: 'session.most_recent', params: { profile: 'work' } },
    {
      method: 'session.create',
      params: { profile: 'work', model: 'model-x' },
    },
    {
      method: 'session.resume',
      params: { session_id: 'same-id', omit_messages: true, profile: 'work' },
    },
    { method: 'session.delete', params: { session_id: 'same-id', profile: 'work' } },
  ]);
});

test('profile is used only for sessionless model/config selection', async () => {
  const calls = [];
  const gateway = new GatewayWs({ wsUrl: 'ws://unused', events: {} });
  gateway.call = async (method, params) => {
    calls.push({ method, params });
    return { providers: [] };
  };

  await gateway.modelOptions(undefined, 'work');
  await gateway.modelOptions('runtime-live');
  await gateway.configSet('approvals.mode', 'manual', undefined, undefined, 'work');

  assert.deepEqual(calls, [
    { method: 'model.options', params: { profile: 'work' } },
    { method: 'model.options', params: { session_id: 'runtime-live' } },
    {
      method: 'config.set',
      params: { key: 'approvals.mode', value: 'manual', profile: 'work' },
    },
  ]);
});

test('toolset REST calls always carry an explicit profile scope', async () => {
  let listedPath = '';
  const toolsets = await getToolsets(async (path) => {
    listedPath = path;
    return { toolsets: [{ name: 'terminal', enabled: true, configured: true, tools: ['shell'] }] };
  }, 'work / review');

  let toggled = null;
  const result = await setToolsetEnabled(
    async (path, method, body) => {
      toggled = { path, method, body };
      return { ok: true, enabled: false };
    },
    'terminal',
    false,
    'work / review',
  );

  assert.equal(toolsets[0].name, 'terminal');
  assert.equal(listedPath, '/api/tools/toolsets?profile=work%20%2F%20review');
  assert.deepEqual(toggled, {
    path: '/api/tools/toolsets/terminal?profile=work%20%2F%20review',
    method: 'PUT',
    body: { enabled: false },
  });
  assert.equal(result.ok, true);
});
