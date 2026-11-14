import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A green Vitest exit alone can mean every browser test was skipped. */
export function assertCompleteResults(report) {
  if (!report?.success || !Number.isInteger(report.numTotalTests) || report.numTotalTests < 1 ||
      report.numPassedTests !== report.numTotalTests || report.numFailedTests !== 0 ||
      report.numPendingTests !== 0 || report.numTodoTests !== 0 || report.numFailedTestSuites !== 0 ||
      !Array.isArray(report.testResults) || report.testResults.length === 0) {
    throw new Error('Verification requires every discovered test to pass: failures, skips, todos and empty reports are not accepted.');
  }
  const assertions = report.testResults.flatMap(result => result.assertionResults ?? []);
  if (assertions.length !== report.numTotalTests || assertions.some(result => result.status !== 'passed') ||
      !report.testResults.some(result => /[/\\]tests[/\\]e2e[/\\]/.test(result.name) && result.assertionResults?.length > 0)) {
    throw new Error('Verification requires executed browser E2E assertions and complete passing assertion results.');
  }
}

export async function verifyTests(filters = []) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  for (const path of ['apps/desktop/dist/renderer/index.html', 'apps/admin-web/dist/index.html']) {
    if (!existsSync(join(root, path))) throw new Error(`Missing ${path}; run npm run build before verification.`);
  }
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({ chromium } = require('playwright')); }
  catch { throw new Error('Playwright is required; install the CI-matched playwright@1.65.0 without saving and install its Chromium browser.'); }
  // Several existing suites use the default executable. Test that exact path;
  // an override must not disguise an unavailable default browser.
  const browser = await chromium.launch();
  await browser.close();
  if (spawnSync('pdftotext', ['-v']).status !== 0) throw new Error('Install poppler-utils: release verification must inspect the generated PDF contents.');
  const directory = mkdtempSync(join(tmpdir(), 'mansora-verification-'));
  try {
    const reportFile = join(directory, 'tests.json');
    const result = spawnSync(process.execPath, [join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs'), 'run', '--maxWorkers=2', ...filters,
      '--reporter=default', '--reporter=json', `--outputFile=${reportFile}`], {
      cwd: root, stdio: 'inherit', env: { ...process.env, MANSORA_REQUIRE_PDF_TEXT: '1' },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Vitest failed (${result.signal ?? result.status}); verification did not pass.`);
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    assertCompleteResults(report);
    console.log(`Verified ${report.numPassedTests}/${report.numTotalTests} tests with browser E2E executed, zero skips and PDF text verification.`);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyTests(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
