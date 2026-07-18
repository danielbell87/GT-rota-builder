import { runSolverTests } from './solver.test.js?v=20260718l';
import { runValidationTests } from './validation.test.js';
import { runScoringTests } from './scoring.test.js?v=20260718k';
import { runAdditionalChefTests } from './additional-chef.test.js';
import { runUiTests } from './ui.test.js?v=20260718s';
import { runPrintTests } from './print.test.js';
import { runBackupTests } from './backup.test.js';
import { runManualEditTests } from './manual-edit.test.js?v=20260718s';
import { runDiagnosticsTests } from './diagnostics.test.js';
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
    await runSolverTests(assert);
    await runValidationTests(assert);
    await runScoringTests(assert);
    await runAdditionalChefTests(assert);
    await runPrintTests(assert);
    await runBackupTests(assert);
    await runManualEditTests(assert);
    await runUiTests(assert);
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
