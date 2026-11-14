import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCompleteResults } from '../scripts/verify-tests.mjs';

const passed = () => ({ success: true, numTotalTests: 1, numPassedTests: 1, numFailedTests: 0,
  numPendingTests: 0, numTodoTests: 0, numFailedTestSuites: 0,
  testResults: [{ name: '/repo/tests/e2e/journey.test.ts', assertionResults: [{ status: 'passed' }] }] });
test('accepts executed passing browser tests on Linux and Windows', () => {
  assert.doesNotThrow(() => assertCompleteResults(passed()));
  const report = passed(); report.testResults[0].name = 'C:\\repo\\tests\\e2e\\journey.test.ts';
  assert.doesNotThrow(() => assertCompleteResults(report));
});
test('rejects green reports that skipped tests, contain todos, failed suites or no executed browser tests', () => {
  assert.throws(() => assertCompleteResults({}));
  for (const patch of [undefined, { success: false }, { numPendingTests: 1 }, { numTodoTests: 1 },
    { numFailedTestSuites: 1 }, { numTotalTests: 0 }, { numPassedTests: 0 }, { testResults: [] },
    { testResults: [{ name: '/repo/tests/e2e/a.test.ts', assertionResults: [{ status: 'pending' }] }] },
    { testResults: [{ name: '/repo/tests/unit/a.test.ts', assertionResults: [{ status: 'passed' }] }] }]) {
    assert.throws(() => assertCompleteResults(patch === undefined ? undefined : { ...passed(), ...patch }));
  }
});
