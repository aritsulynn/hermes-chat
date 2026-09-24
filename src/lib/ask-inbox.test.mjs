import assert from 'node:assert/strict';
import test from 'node:test';

import {
  askKey,
  findAskByRpc,
  pendingAsks,
  setAskStatus,
  setAskStatusByRpc,
  upsertAsk,
} from './ask-inbox.ts';

const owner = (overrides = {}) => ({
  connectionId: 'host-a',
  profile: 'work',
  storedSessionId: 'stored-1',
  runtimeSessionId: 'runtime-1',
  resolved: true,
  ...overrides,
});

test('ask keys include the owner namespace', () => {
  assert.notEqual(
    askKey(owner(), 'srq-1'),
    askKey(owner({ profile: 'personal' }), 'srq-1'),
  );
  assert.notEqual(
    askKey(owner({ connectionId: 'host-b' }), 'srq-1'),
    askKey(owner(), 'srq-1'),
  );
});

test('replayed asks upsert the same request after a runtime remint', () => {
  const first = upsertAsk([], {
    rpcId: 'srq-1',
    method: 'approval',
    sessionId: 'runtime-1',
    params: { command: 'ls' },
    owner: owner(),
  });
  const second = upsertAsk(first.entries, {
    rpcId: 'srq-1',
    method: 'approval',
    sessionId: 'runtime-2',
    params: { command: 'ls' },
    owner: owner({ runtimeSessionId: 'runtime-2' }),
    replayed: true,
  });

  assert.equal(first.added, true);
  assert.equal(second.added, false);
  assert.equal(second.entries.length, 1);
  assert.equal(second.entry.sessionId, 'runtime-2');
  assert.equal(second.entry.owner.runtimeSessionId, 'runtime-2');
});

test('a settled request is not resurrected by a late replay', () => {
  const first = upsertAsk([], {
    rpcId: 'srq-1',
    method: 'approval',
    owner: owner(),
  });
  const answered = setAskStatus(first.entries, first.entry.key, 'answered');
  const replay = upsertAsk(answered, {
    rpcId: 'srq-1',
    method: 'approval',
    owner: owner(),
    replayed: true,
  });

  assert.equal(replay.added, false);
  assert.equal(replay.entry.status, 'answered');
  assert.deepEqual(replay.entries, answered);
});

test('a sent request can be re-armed by authoritative open-request replay', () => {
  const first = upsertAsk([], {
    rpcId: 'srq-1',
    method: 'approval',
    owner: owner(),
  });
  const sent = setAskStatus(first.entries, first.entry.key, 'sent');
  const replay = upsertAsk(sent, {
    rpcId: 'srq-1',
    method: 'approval',
    owner: owner({ runtimeSessionId: 'runtime-2' }),
    sessionId: 'runtime-2',
    replayed: true,
  });

  assert.equal(replay.added, false);
  assert.equal(replay.entry.status, 'pending');
  assert.equal(replay.entry.sessionId, 'runtime-2');
});

test('status updates can target a request by connection and rpc id', () => {
  const first = upsertAsk([], {
    rpcId: 'srq-1',
    method: 'clarify',
    owner: owner(),
  });
  const cancelled = setAskStatusByRpc(
    first.entries,
    'host-a',
    'srq-1',
    'cancelled',
  );

  assert.equal(cancelled[0].status, 'cancelled');
  assert.equal(pendingAsks(cancelled).length, 0);
  assert.equal(findAskByRpc(cancelled, 'host-a', 'srq-1').status, 'cancelled');
  assert.equal(
    setAskStatus(cancelled, 'missing', 'answered')[0].status,
    'cancelled',
  );
});
