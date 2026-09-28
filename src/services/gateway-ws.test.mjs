import assert from 'node:assert/strict';
import test from 'node:test';

import { GatewayWs, isCurrentSessionEvent } from './gateway-ws.ts';

test('routes session.usage events to the focused session callback', () => {
  let received = null;
  const gateway = new GatewayWs({
    wsUrl: 'ws://unused',
    events: {
      onUsage: (sessionId, usage) => {
        received = { sessionId, usage };
      },
    },
  });

  gateway.dispatch('session.usage', 'runtime-1', {
    usage: { context_percent: 42, input: 1200 },
  });

  assert.deepEqual(received, {
    sessionId: 'runtime-1',
    usage: { context_percent: 42, input: 1200 },
  });
});

test('requests a context snapshot that can be computed from restored history', async () => {
  const calls = [];
  const gateway = new GatewayWs({
    wsUrl: 'ws://unused',
    events: {},
  });
  gateway.call = async (method, params) => {
    calls.push({ method, params });
    return { context_max: 200_000, context_used: 42_000, context_percent: 21 };
  };

  const result = await gateway.contextBreakdown('runtime-1');

  assert.deepEqual(calls, [
    { method: 'session.context_breakdown', params: { session_id: 'runtime-1' } },
  ]);
  assert.equal(result.context_percent, 21);
});

test('registers a server ask and replies only once', () => {
  const asks = [];
  const sent = [];
  const gateway = new GatewayWs({
    wsUrl: 'ws://unused',
    events: { onAsk: (ask) => asks.push(ask) },
  });
  gateway.route({
    id: 'srq-approval-1',
    method: 'approval',
    params: { session_id: 'runtime-1', command: 'ls' },
  });
  gateway.ws = { readyState: 1, send: (frame) => sent.push(JSON.parse(frame)) };

  assert.equal(asks.length, 1);
  assert.equal(asks[0].replayed, false);
  assert.equal(gateway.replyToAsk('srq-approval-1', { choice: 'once' }), true);
  assert.equal(gateway.replyToAsk('srq-approval-1', { choice: 'deny' }), false);
  assert.deepEqual(sent, [{ jsonrpc: '2.0', id: 'srq-approval-1', result: { choice: 'once' } }]);
});

test('marks a cancelled ask as non-replayable', () => {
  const asks = [];
  const gateway = new GatewayWs({
    wsUrl: 'ws://unused',
    events: { onAsk: (ask) => asks.push(ask) },
  });
  gateway.route({ id: 'srq-1', method: 'clarify', params: { session_id: 'runtime-1' } });
  gateway.dispatch('request.cancel', 'runtime-1', {
    id: 'srq-1',
    method: 'clarify',
    reason: 'timeout',
  });
  gateway.deliverOpenRequests({ open_requests: [{ id: 'srq-1', method: 'clarify', params: { session_id: 'runtime-1' } }] });

  assert.equal(asks.length, 1);
  assert.equal(gateway.replyToAsk('srq-1', { answer: 'late' }), false);
});

test('does not answer a request record from an older socket generation', () => {
  const frames = [];
  const gateway = new GatewayWs({ wsUrl: 'ws://unused', events: {} });
  gateway.route({ id: 'srq-old', method: 'clarify', params: { session_id: 'runtime-1' } });
  gateway.socketGeneration = 2;
  gateway.ws = { readyState: 1, send: (frame) => frames.push(JSON.parse(frame)) };

  assert.equal(gateway.replyToAsk('srq-old', { answer: 'stale' }), false);
  assert.equal(frames.length, 0);
});

test('re-arms a sent request only when open_requests says it is still open', () => {
  const asks = [];
  const frames = [];
  const gateway = new GatewayWs({
    wsUrl: 'ws://unused',
    events: { onAsk: (ask) => asks.push(ask) },
  });
  gateway.ws = { readyState: 1, send: (frame) => frames.push(JSON.parse(frame)) };
  gateway.route({ id: 'srq-1', method: 'approval', params: { session_id: 'runtime-1' } });
  assert.equal(gateway.replyToAsk('srq-1', { choice: 'once' }), true);
  assert.equal(gateway.replyToAsk('srq-1', { choice: 'deny' }), false);

  gateway.deliverOpenRequests({ open_requests: [{ id: 'srq-1', method: 'approval', params: { session_id: 'runtime-1' } }] });
  assert.equal(asks.length, 2);
  assert.equal(asks[1].replayed, true);
  assert.equal(gateway.replyToAsk('srq-1', { choice: 'deny' }), true);
  assert.equal(frames.length, 2);
});

test('re-delivers open requests from an RPC response as replayed', async () => {
  const asks = [];
  const frames = [];
  const gateway = new GatewayWs({
    wsUrl: 'ws://unused',
    events: { onAsk: (ask) => asks.push(ask) },
  });
  gateway.ws = { readyState: 1, send: (frame) => frames.push(JSON.parse(frame)) };

  const result = gateway.call('session.events.since', { session_id: 'runtime-1', last_seen: 0 });
  await Promise.resolve();
  const request = frames[0];
  gateway.route({
    id: request.id,
    result: {
      open_requests: [{ id: 'srq-replay', method: 'approval', params: { session_id: 'runtime-1', command: 'pwd' } }],
    },
  });
  assert.deepEqual(await result, { open_requests: [{ id: 'srq-replay', method: 'approval', params: { session_id: 'runtime-1', command: 'pwd' } }] });
  assert.equal(asks.length, 1);
  assert.equal(asks[0].replayed, true);
});

test('syncOpenRequests reports an empty snapshot for stale inbox cleanup', async () => {
  const snapshots = [];
  const frames = [];
  const gateway = new GatewayWs({
    wsUrl: 'ws://unused',
    events: { onAskSnapshot: (sid, ids) => snapshots.push({ sid, ids }) },
  });
  gateway.ws = { readyState: 1, send: (frame) => frames.push(JSON.parse(frame)) };
  const syncing = gateway.syncOpenRequests(['runtime-1']);
  await Promise.resolve();
  gateway.route({ id: frames[0].id, result: { open_requests: [] } });
  await syncing;

  assert.deepEqual(snapshots, [{ sid: 'runtime-1', ids: [] }]);
});

test('fails unsupported server asks instead of showing a generic secret form', () => {
  const asks = [];
  const frames = [];
  const gateway = new GatewayWs({
    wsUrl: 'ws://unused',
    events: { onAsk: (ask) => asks.push(ask) },
  });
  gateway.ws = { readyState: 1, send: (frame) => frames.push(JSON.parse(frame)) };
  gateway.route({ id: 'srq-unknown', method: 'vault.save_login', params: { session_id: 'runtime-1' } });

  assert.equal(asks.length, 0);
  assert.deepEqual(frames, [{
    jsonrpc: '2.0',
    id: 'srq-unknown',
    error: { code: -32601, message: 'unsupported server request: vault.save_login' },
  }]);
});

test('isCurrentSessionEvent accepts the runtime id or the stored id of the open room', () => {
  // Live runtime id (session.resume) — the normal case.
  assert.equal(isCurrentSessionEvent('live-1', 'live-1', 'stored-9'), true);
  // Stored id (session.list / sessionKey) — some gateways tag events with it.
  assert.equal(isCurrentSessionEvent('stored-9', 'live-1', 'stored-9'), true);
  // Another room's ids must never leak into the open chat.
  assert.equal(isCurrentSessionEvent('live-2', 'live-1', 'stored-9'), false);
  assert.equal(isCurrentSessionEvent('stored-8', 'live-1', 'stored-9'), false);
  // Empty sid is connection-scoped (gateway.ready style) — fail open.
  assert.equal(isCurrentSessionEvent('', 'live-1', 'stored-9'), true);
  // No current runtime (profile switch gap) — fail closed, even for the stored key.
  assert.equal(isCurrentSessionEvent('stored-9', null, 'stored-9'), false);
  assert.equal(isCurrentSessionEvent('live-1', null, 'stored-9'), false);
});

test('dispatch records the last event sid for on-device diagnostics', () => {
  const gateway = new GatewayWs({ wsUrl: 'ws://unused', events: {} });
  gateway.dispatch('message.delta', 'stored-9', { text: 'hi' });
  gateway.dispatch('message.delta', 'stored-9', { text: ' there' });

  const debug = gateway.wsDebug();
  assert.equal(debug.lastEvent, 'message.delta');
  assert.equal(debug.lastSid, 'stored-9');
  assert.equal(debug.eventCounts['message.delta'], 2);
});
