import assert from 'node:assert/strict';
import test from 'node:test';

import { GatewayWs } from './gateway-ws.ts';

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
