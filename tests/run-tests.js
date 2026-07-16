import { runSolverTests } from './solver.test.js';
import { runValidationTests } from './validation.test.js';
import { runScoringTests } from './scoring.test.js';
import { runAdditionalChefTests } from './additional-chef.test.js';
import { runUiTests } from './ui.test.js';
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

  await runSolverTests(assert);
  await runValidationTests(assert);
  await runScoringTests(assert);
  await runAdditionalChefTests(assert);
  await runUiTests(assert);

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  summaryEl.textContent = `Engine: ${SOLVER_ENGINE_VERSION} | Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`;
  resultsEl.innerHTML = results.map((r) => `<div class="pill ${r.passed ? 'good' : 'bad'}">${r.passed ? 'PASS' : 'FAIL'}: ${r.title}${r.details ? ` (${r.details})` : ''}</div>`).join('');
}

const runButton = document.getElementById('runTestsBtn');
if (runButton) runButton.addEventListener('click', runAllTests);
runAllTests();
