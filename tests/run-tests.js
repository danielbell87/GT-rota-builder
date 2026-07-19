import { runSolverTests } from './solver.test.js?v=20260719u';
import { runValidationTests } from './validation.test.js';
import { runScoringTests } from './scoring.test.js?v=20260719u';
import { runAdditionalChefTests } from './additional-chef.test.js?v=20260719u';
import { runUiTests } from './ui.test.js?v=20260719u';
import { runPrintTests } from './print.test.js?v=20260719u';
import { runBackupTests } from './backup.test.js';
import { runManualEditTests } from './manual-edit.test.js?v=20260719u';
import { runDiagnosticsTests } from './diagnostics.test.js';
import { runUiPolishTests } from './ui-polish.test.js?v=20260719u';
import { SOLVER_ENGINE_VERSION } from '../js/solver.js';

const summaryEl = document.getElementById('testSummary');
const resultsEl = document.getElementById('testResults');

function createAssert(results) {
  return function assert(condition, title, details = '') {
    results.push({ passed: !!condition, title, details });
  };
}

async function runAllTests() {
  const results = [];
  const assert = createAssert(results);

  try {
    summaryEl.textContent = 'Running solver tests…';
    await runSolverTests(assert);
    summaryEl.textContent = 'Running validation tests…';
    await runValidationTests(assert);
    summaryEl.textContent = 'Running scoring tests…';
    await runScoringTests(assert);
    summaryEl.textContent = 'Running additional-chef tests…';
    await runAdditionalChefTests(assert);
    summaryEl.textContent = 'Running print tests…';
    await runPrintTests(assert);
    summaryEl.textContent = 'Running backup tests…';
    await runBackupTests(assert);
    summaryEl.textContent = 'Running manual-edit tests…';
    await runManualEditTests(assert);
    summaryEl.textContent = 'Running UI polish tests…';
    await runUiPolishTests(assert);
    summaryEl.textContent = 'Running UI tests…';
    await runUiTests(assert);
    summaryEl.textContent = 'Running diagnostics tests…';
    await runDiagnosticsTests(assert);
  } catch (error) {
    results.push({
      passed: false,
      title: 'Unhandled test runner error',
      details: error?.stack || error?.message || String(error)
    });
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  summaryEl.textContent = `Engine: ${SOLVER_ENGINE_VERSION} | Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`;
  resultsEl.innerHTML = results.map((r) => `<div class="pill ${r.passed ? 'good' : 'bad'}">${r.passed ? 'PASS' : 'FAIL'}: ${r.title}${r.details ? ` (${r.details})` : ''}</div>`).join('');
}

document.getElementById('runTestsBtn').addEventListener('click', runAllTests);
runAllTests();
