import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionOutcomeLabel,
  actionOutcomeTone,
  normalizeActionStatus,
  normalizeReceiptSummary,
  normalizeUpdateCheck,
  receiptOutcomeLabel,
  receiptOutcomeTone,
  updateStatusLabel,
  updateStatusTone,
} from './hermes-update.ts';

test('normalizeUpdateCheck maps the backend snake_case payload', () => {
  const info = normalizeUpdateCheck({
    install_method: 'git',
    current_version: '0.21.4',
    behind: 3,
    update_available: true,
    can_apply: true,
    update_command: 'hermes update',
    message: null,
    commits: [
      { sha: 'abc1234', summary: 'fix: thing', author: 'lynn', at: 1700000000 },
      { sha: '', summary: '', author: '', at: 'nope' },
    ],
  });
  assert.equal(info.installMethod, 'git');
  assert.equal(info.currentVersion, '0.21.4');
  assert.equal(info.behind, 3);
  assert.equal(info.updateAvailable, true);
  assert.equal(info.canApply, true);
  assert.equal(info.updateCommand, 'hermes update');
  assert.equal(info.message, '');
  assert.deepEqual(info.commits[0], {
    sha: 'abc1234',
    summary: 'fix: thing',
    author: 'lynn',
    at: 1700000000,
  });
  // Missing/invalid numeric fields collapse to 0 rather than NaN.
  assert.equal(info.commits[1].at, 0);
});

test('normalizeUpdateCheck tolerates a missing payload', () => {
  const info = normalizeUpdateCheck(null);
  assert.equal(info.installMethod, 'unknown');
  assert.equal(info.currentVersion, '');
  assert.equal(info.behind, null);
  assert.equal(info.updateAvailable, false);
  assert.equal(info.canApply, false);
  assert.deepEqual(info.commits, []);
});

test('normalizeActionStatus parses the live log + receipt summary', () => {
  const st = normalizeActionStatus({
    name: 'hermes-update',
    running: false,
    exit_code: 0,
    pid: 4242,
    lines: ['=== hermes-update started ===', 'ok'],
    action_id: 'deadbeef',
    receipt: {
      outcome: 'success',
      started_at: '2026-09-25T00:00:00Z',
      finished_at: '2026-09-25T00:02:00Z',
      pre_sha: 'aaa',
      post_sha: 'bbb',
      post_version: '0.21.5',
      fleet_states: ['running', 'running'],
    },
  });
  assert.equal(st.running, false);
  assert.equal(st.exitCode, 0);
  assert.equal(st.lines.length, 2);
  assert.equal(st.actionId, 'deadbeef');
  assert.equal(st.receipt?.outcome, 'success');
  assert.deepEqual(st.receipt?.fleetStates, ['running', 'running']);
});

test('normalizeReceiptSummary rejects non-objects and de-dupes nothing', () => {
  assert.equal(normalizeReceiptSummary(null), null);
  assert.equal(normalizeReceiptSummary('success'), null);
  assert.deepEqual(normalizeReceiptSummary({}).fleetStates, []);
});

test('updateStatusLabel distinguishes applyable, external, and unknown', () => {
  const base = normalizeUpdateCheck({ install_method: 'git', can_apply: true });
  assert.equal(updateStatusLabel(null), 'Not checked');
  assert.equal(updateStatusLabel({ ...base, updateAvailable: true, behind: 2 }), '2 commits behind');
  assert.equal(updateStatusLabel({ ...base, updateAvailable: true, behind: 1 }), '1 commit behind');
  assert.equal(updateStatusLabel({ ...base, updateAvailable: true, behind: null }), 'Update available');
  assert.equal(updateStatusLabel({ ...base, behind: 0 }), 'Up to date');
  assert.equal(updateStatusLabel({ ...base, behind: null }), "Couldn't check");

  const external = normalizeUpdateCheck({
    install_method: 'docker',
    can_apply: false,
    message: 'Updates are managed outside this dashboard.',
  });
  assert.equal(updateStatusLabel(external), 'Managed externally');
});

test('updateStatusTone flags updates and the unknown state', () => {
  assert.equal(updateStatusTone(null), 'muted');
  assert.equal(updateStatusTone(normalizeUpdateCheck({ update_available: true })), 'warning');
  assert.equal(updateStatusTone(normalizeUpdateCheck({ behind: 0, can_apply: true })), 'success');
  assert.equal(updateStatusTone(normalizeUpdateCheck({ behind: null, can_apply: true })), 'warning');
});

test('action outcome labels/tone cover running, done, finished, failed', () => {
  assert.equal(actionOutcomeLabel(true, null), 'running');
  assert.equal(actionOutcomeLabel(false, 0), 'done');
  assert.equal(actionOutcomeLabel(false, null), 'finished');
  assert.equal(actionOutcomeLabel(false, 1), 'exit 1');
  assert.equal(actionOutcomeTone(true, null), 'warning');
  assert.equal(actionOutcomeTone(false, 0), 'success');
  assert.equal(actionOutcomeTone(false, 1), 'danger');
  assert.equal(actionOutcomeTone(false, null), 'muted');
});

test('receipt outcome labels surface the new version on success', () => {
  assert.equal(receiptOutcomeLabel(null), '');
  assert.equal(
    receiptOutcomeLabel(normalizeReceiptSummary({ outcome: 'success', post_version: '0.21.5' })),
    'Update succeeded — now v0.21.5',
  );
  assert.equal(receiptOutcomeLabel(normalizeReceiptSummary({ outcome: 'partial' })), 'Update partially applied');
  assert.equal(
    receiptOutcomeLabel(normalizeReceiptSummary({ outcome: 'success', post_version: 'v0.21.5' })),
    'Update succeeded — now v0.21.5',
  );
  assert.equal(receiptOutcomeTone(normalizeReceiptSummary({ outcome: 'success' })), 'success');
  assert.equal(receiptOutcomeTone(normalizeReceiptSummary({ outcome: 'partial' })), 'warning');
  assert.equal(receiptOutcomeTone(normalizeReceiptSummary({ outcome: 'failed' })), 'danger');
});
