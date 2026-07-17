import { CACHE_BUST_VERSION } from '../js/constants.js';
import { buildMultiWeekRota } from '../js/solver.js';
import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { getWeekValidationView, renderWeekPanel } from '../js/render.js';

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitFor(predicate, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = predicate();
    if (value) return value;
    await wait(50);
  }
  throw new Error('Timed out waiting for condition');
}

async function loadFrame(url) {
  const frame = document.createElement('iframe');
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  document.body.appendChild(frame);
  await new Promise((resolve, reject) => {
    frame.onload = () => resolve();
    frame.onerror = reject;
    frame.src = url;
  });
  await waitFor(() => frame.contentWindow?.__gtRotaBootstrap?.status || frame.contentWindow?.location?.pathname.endsWith('/index.html'));
  await wait(100);
  return frame;
}

function destroyFrame(frame) {
  frame?.remove();
}

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPersistedAppState(frameWindow) {
  return JSON.parse(frameWindow.localStorage.getItem('gtRota.state.v2'));
}

function buildResultFromPersistedState(persistedState) {
  resetStateToDefaults();
  const state = getState();
  if (Array.isArray(persistedState?.staff)) state.staff = cloneData(persistedState.staff);
  if (persistedState?.settings && typeof persistedState.settings === 'object') state.settings = cloneData(persistedState.settings);
  if (persistedState?.weeklyInputs && typeof persistedState.weeklyInputs === 'object') {
    state.weeklyInputs = { ...state.weeklyInputs, ...cloneData(persistedState.weeklyInputs) };
  }
  syncCompatibilityViews();
  return buildMultiWeekRota({
    ...cloneData(state.weeklyInputs),
    weeklyMioSelections: { ...(state.weeklyInputs.weeklyMioSelections || {}) }
  });
}

function serializeWeek(week) {
  return JSON.stringify({
    status: week.status,
    weekStart: week.weekStart,
    mioChef: week.mioChef,
    inputs: week.inputs,
    rota: week.rota,
    summary: week.summary
  });
}

function hasAssignment(week, chefName, predicate = () => true) {
  return week.rota.some((day) => predicate(day) && day.assignments.some((assignment) => assignment.chef === chefName));
}

function getWeekPanel(doc, index) {
  return doc.querySelector(`section[data-week-panel="${index}"]`);
}

function getChefHoursText(doc, weekIndex, chefName) {
  const rows = [...(getWeekPanel(doc, weekIndex)?.querySelectorAll('.chef-hours-table tbody tr') || [])];
  const match = rows.find((row) => row.querySelector('th')?.textContent === chefName);
  return match ? [...match.querySelectorAll('td')].map((cell) => cell.textContent.trim()).join(' | ') : '';
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getVisibleTextFromElement(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll('.hidden').forEach((node) => node.remove());
  clone.querySelectorAll('.technical-details:not([open])').forEach((details) => {
    [...details.children].forEach((child) => {
      if (child.tagName !== 'SUMMARY') child.remove();
    });
  });
  return normalizeText(clone.textContent);
}

function getVisibleResultsText(doc) {
  return getVisibleTextFromElement(doc.getElementById('results'));
}

function buildSyntheticWeekPanel() {
  resetStateToDefaults();
  const state = getState();
  const syntheticWeek = {
    weekIndex: 0,
    weekNumber: 1,
    weekStart: '2026-07-13',
    status: 'ok',
    inputs: {
      weekStart: '2026-07-13',
      mioChef: 'Dan',
      status: 'Draft',
      availability: [],
      additionalChefRequirements: []
    },
    rota: [],
    summary: [
      { name: 'Connor', gtDays: 4, mioDays: 0, annualLeaveHours: 0, totalCreditedHours: 48, hours: 48 }
    ],
    hardValidation: [
      { ruleId: 'H008', passed: true, severity: 'hard', message: 'Thursday: at least one Sous Chef or higher required' }
    ],
    softValidation: [
      { ruleId: 'prefer-senior-on-pass', passed: false, severity: 'soft', message: 'Connor worked consecutive Sundays because senior Sauce cover was required.' },
      { ruleId: 'prefer-senior-on-pass', passed: true, severity: 'soft', message: 'Friday: senior chef Charlie assigned to Pass' }
    ],
    softScore: {
      valid: true,
      score: 88,
      capped: false,
      explanation: ['Connor worked consecutive Sundays because senior Sauce cover was required.']
    }
  };
  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderWeekPanel(getWeekValidationView(syntheticWeek, state));
  return wrapper;
}

async function setFieldValue(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(150);
}

async function setCheckboxValue(frameWindow, element, checked) {
  element.checked = checked;
  element.dispatchEvent(new frameWindow.Event('change', { bubbles: true }));
  await wait(150);
}

async function clickElement(element) {
  element.click();
  await wait(150);
}

async function openChefEditorByName(doc, chefName) {
  const row = [...doc.querySelectorAll('[data-open-chef-id]')].find((button) => normalizeText(button.textContent).includes(chefName));
  if (!row) throw new Error(`Chef row not found for ${chefName}`);
  row.click();
  await waitFor(() => doc.getElementById('chefModal').classList.contains('open'));
  return row;
}

function getModal(doc) {
  return doc.getElementById('chefModal');
}

function getModalText(doc) {
  return normalizeText(doc.getElementById('chefModal').textContent);
}

export async function runUiTests(assert) {
  localStorage.clear();
  const stateModule = await import('../js/state.js');
  const appSource = await fetch(`../js/app.js?v=${CACHE_BUST_VERSION}`).then((response) => response.text());
  const stateImportMatch = appSource.match(/import\s*\{([^}]+)\}\s*from\s*'\.\/state\.js'/);
  const importedSymbols = stateImportMatch?.[1]
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean) || [];
  assert(importedSymbols.every((symbol) => symbol in stateModule), 'UI: state.js exports every symbol imported by app.js');

  const canonicalMarkup = await fetch('../index.html').then((response) => response.text());
  const canonicalDoc = new DOMParser().parseFromString(canonicalMarkup, 'text/html');
  assert(!!canonicalDoc.querySelector('#numWeeks'), 'UI: canonical page contains #numWeeks');
  const stylesText = await fetch('../styles.css').then((response) => response.text());
  assert(stylesText.includes('.technical-details') && stylesText.includes('@media print'), 'UI: stylesheet includes technical-details and print rules for validation cleanup');
  assert(stylesText.includes('.week-panels .week-panel.hidden') && stylesText.includes('display: grid;'), 'UI: print stylesheet restores hidden week panels for printing');

  const syntheticPanel = buildSyntheticWeekPanel();
  assert(!!syntheticPanel.querySelector('.week-panel'), 'UI: synthetic validation panel renders a week-panel wrapper');
  const syntheticVisibleText = getVisibleTextFromElement(syntheticPanel.querySelector('.week-panel'));
  const syntheticDetails = syntheticPanel.querySelector('details.technical-details');
  assert(syntheticVisibleText.includes('Scheduling compromises'), 'UI: soft failures render in a separate scheduling-compromises section');
  assert(syntheticVisibleText.includes('Connor worked consecutive Sundays because senior Sauce cover was required.'), 'UI: failed soft preferences are shown to the user');
  assert(!syntheticVisibleText.includes('Friday: senior chef Charlie assigned to Pass'), 'UI: successful soft preferences are hidden from the normal interface');
  assert(!syntheticVisibleText.includes('prefer-senior-on-pass'), 'UI: soft-rule IDs are hidden from normal user-facing text');
  assert(!!syntheticDetails && syntheticDetails.open === false, 'UI: technical details are collapsed by default');
  assert(normalizeText(syntheticDetails.textContent).includes('prefer-senior-on-pass'), 'UI: technical details retain soft-rule IDs');
  assert(normalizeText(syntheticDetails.textContent).includes('Friday: senior chef Charlie assigned to Pass'), 'UI: technical details retain successful soft checks');

  let canonicalFrame = null;
  try {
    canonicalFrame = await loadFrame('../index.html');
    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.status === 'ok', 'UI: fresh application import completes without module errors');
    assert(canonicalFrame.contentWindow.location.pathname.endsWith('/index.html'), 'UI: canonical URL loads successfully');
    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.status === 'ok', 'UI: canonical URL loads without console errors');

    const doc = canonicalFrame.contentDocument;
    await setFieldValue(doc.getElementById('weekStart'), '2026-07-13');
    await setFieldValue(doc.getElementById('numWeeks'), '1');
    await waitFor(() => doc.querySelector('details.technical-details'));

    const visibleSingleWeekText = getVisibleResultsText(doc);
    const singleWeekDetails = doc.querySelector('details.technical-details');
    const singleWeekTables = singleWeekDetails.querySelectorAll('.technical-table');
    assert(singleWeekTables.length >= 2, 'UI: technical details render hard and soft validation tables');
    const singleWeekHardTable = singleWeekTables[0];
    const singleWeekSoftTable = singleWeekTables[1];
    const singleWeekRender = canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender;
    assert(visibleSingleWeekText.includes('✓ Rota valid') && visibleSingleWeekText.includes('No hard-rule problems found.'), 'UI: valid one-week rota shows one concise success status');
    assert(!visibleSingleWeekText.includes('H008') && !visibleSingleWeekText.includes('at least one Sous Chef or higher required'), 'UI: successful hard-rule checks are hidden from the normal one-week interface');
    assert(singleWeekDetails.open === false, 'UI: one-week technical details stay collapsed by default');
    assert(singleWeekHardTable.querySelectorAll('tbody tr').length === singleWeekRender.validationByWeek[0].hardValidation.length, 'UI: technical details include the full hard-validation dataset');
    assert(singleWeekSoftTable.querySelectorAll('tbody tr').length === singleWeekRender.validationByWeek[0].softValidation.length, 'UI: technical details include the full soft-validation dataset');
    assert(singleWeekRender.validationByWeek[0].hardValidation.some((result) => result.passed), 'UI: complete hard-validation arrays remain available in application state data');
    assert(normalizeText(singleWeekDetails.textContent).includes('H008'), 'UI: hard-rule IDs remain visible inside technical details');
    assert(normalizeText(singleWeekDetails.textContent).includes('prefer-senior-on-pass'), 'UI: soft-rule IDs remain visible inside technical details');

    await setFieldValue(doc.getElementById('numWeeks'), '3');
    await waitFor(() => doc.querySelectorAll('select[data-weekly-mio-start]').length === 3);

    assert(doc.querySelectorAll('section[data-week-panel]').length === 3, 'UI: selecting three weeks produces three generated week results');
    assert(doc.querySelectorAll('select[data-weekly-mio-start]').length === 3, 'UI: three weeks display three MIO selectors');
    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.mode === 'multi', 'UI: multi-week rendering does not call only buildRota()');

    const weeklySelectors = [...doc.querySelectorAll('select[data-weekly-mio-start]')];
    await setFieldValue(weeklySelectors[0], 'Fred');
    await setFieldValue(weeklySelectors[1], 'Brooke');
    await setFieldValue(weeklySelectors[2], 'Dan');
    assert(JSON.stringify(canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.weekMioChefs) === JSON.stringify(['Fred', 'Brooke', 'Dan']), 'UI: different MIO chefs are passed to different weeks');

    const resultsEl = doc.getElementById('results');
    const baselineResultsHtml = resultsEl.innerHTML;
    const baselinePersistedState = getPersistedAppState(canonicalFrame.contentWindow);
    const baselineMultiWeek = buildResultFromPersistedState(baselinePersistedState);
    const baselineWeekSnapshots = baselineMultiWeek.weeks.map(serializeWeek);

    doc.getElementById('addAvailabilityBtn').click();
    await waitFor(() => doc.querySelectorAll('#availabilityBody tr').length === 1);
    const leaveRow = doc.querySelector('#availabilityBody tr');
    await setFieldValue(leaveRow.querySelector('.entry-chef'), 'Joel');
    await setFieldValue(leaveRow.querySelector('.entry-type'), 'Annual Leave');
    await setFieldValue(leaveRow.querySelector('.entry-start-date'), '2026-07-20');
    await setFieldValue(leaveRow.querySelector('.entry-finish-date'), '2026-07-26');
    await waitFor(() => resultsEl.innerHTML !== baselineResultsHtml);
    const joelLeaveState = getPersistedAppState(canonicalFrame.contentWindow);
    const joelLeaveResult = buildResultFromPersistedState(joelLeaveState);
    const joelLeaveWeekTwo = joelLeaveResult.weeks[1];
    const joelLeaveSummary = joelLeaveWeekTwo.summary.find((item) => item.name === 'Joel');
    assert(serializeWeek(joelLeaveResult.weeks[0]) === baselineWeekSnapshots[0], 'UI: Joel annual leave keeps week 1 unchanged');
    assert(serializeWeek(joelLeaveWeekTwo) !== baselineWeekSnapshots[1], 'UI: Joel annual leave changes week 2');
    assert(serializeWeek(joelLeaveResult.weeks[2]) === baselineWeekSnapshots[2], 'UI: Joel annual leave keeps week 3 unchanged');
    assert(!hasAssignment(joelLeaveWeekTwo, 'Joel'), 'UI: Joel has no assignments during his week-2 annual leave');
    assert((joelLeaveSummary?.annualLeaveHours || 0) === 48, 'UI: Joel receives 48 leave-credit hours for week-2 annual leave');
    assert(getChefHoursText(doc, 1, 'Joel').includes('48.0h'), 'UI: Joel leave credit is rendered in the week-2 summary');

    leaveRow.querySelector('button[data-remove]').click();
    await waitFor(() => doc.querySelectorAll('#availabilityBody tr').length === 0);
    await waitFor(() => resultsEl.innerHTML === baselineResultsHtml);
    const removedJoelState = getPersistedAppState(canonicalFrame.contentWindow);
    const removedJoelResult = buildResultFromPersistedState(removedJoelState);
    const removedJoelSummary = removedJoelResult.weeks[1].summary.find((item) => item.name === 'Joel');
    assert((removedJoelSummary?.annualLeaveHours || 0) === 0, 'UI: removing Joel leave clears his leave credit');
    assert((removedJoelState.weeklyInputs.availability || []).length === 0, 'UI: removing Joel leave clears persisted availability state');
    assert(JSON.stringify(removedJoelResult) === JSON.stringify(baselineMultiWeek), 'UI: removing Joel leave restores the deterministic baseline rota');

    doc.getElementById('addAvailabilityBtn').click();
    await waitFor(() => doc.querySelectorAll('#availabilityBody tr').length === 1);
    const unavailableRow = doc.querySelector('#availabilityBody tr');
    await setFieldValue(unavailableRow.querySelector('.entry-chef'), 'Connor');
    await setFieldValue(unavailableRow.querySelector('.entry-type'), 'Unavailable');
    await setFieldValue(unavailableRow.querySelector('.entry-start-date'), '2026-07-23');
    await setFieldValue(unavailableRow.querySelector('.entry-finish-date'), '2026-07-23');
    await waitFor(() => (getPersistedAppState(canonicalFrame.contentWindow)?.weeklyInputs?.availability || []).some((entry) => entry.chef === 'Connor'));
    const connorUnavailableState = getPersistedAppState(canonicalFrame.contentWindow);
    const connorUnavailableResult = buildResultFromPersistedState(connorUnavailableState);
    const connorUnavailableWeekTwo = connorUnavailableResult.weeks[1];
    const connorUnavailableSummary = connorUnavailableWeekTwo.summary.find((item) => item.name === 'Connor');
    assert(serializeWeek(connorUnavailableResult.weeks[0]) === baselineWeekSnapshots[0], 'UI: Connor unavailable keeps week 1 unchanged');
    assert(serializeWeek(connorUnavailableWeekTwo) !== baselineWeekSnapshots[1], 'UI: Connor unavailable changes week 2');
    assert(serializeWeek(connorUnavailableResult.weeks[2]) === baselineWeekSnapshots[2], 'UI: Connor unavailable keeps week 3 unchanged');
    assert(!hasAssignment(connorUnavailableWeekTwo, 'Connor', (day) => day.dayName === 'Thursday'), 'UI: Connor is absent on the unavailable Thursday only');
    assert(hasAssignment(connorUnavailableWeekTwo, 'Connor', (day) => day.dayName !== 'Thursday'), 'UI: Connor remains eligible outside the unavailable Thursday');
    assert((connorUnavailableSummary?.annualLeaveHours || 0) === 0, 'UI: Connor unavailable adds no leave credit');

    unavailableRow.querySelector('button[data-remove]').click();
    await waitFor(() => doc.querySelectorAll('#availabilityBody tr').length === 0);
    await waitFor(() => resultsEl.innerHTML === baselineResultsHtml);
    const removedConnorState = getPersistedAppState(canonicalFrame.contentWindow);
    const removedConnorResult = buildResultFromPersistedState(removedConnorState);
    assert((removedConnorState.weeklyInputs.availability || []).length === 0, 'UI: removing Connor unavailable clears persisted availability state');
    assert(JSON.stringify(removedConnorResult) === JSON.stringify(baselineMultiWeek), 'UI: removing Connor unavailable restores Connor to the baseline rota');

    let availabilityReloadFrame = null;
    try {
      availabilityReloadFrame = await loadFrame('../index.html');
      assert(availabilityReloadFrame.contentDocument.querySelectorAll('#availabilityBody tr').length === 0, 'UI: removed availability rows stay gone after reload');
      assert((getPersistedAppState(availabilityReloadFrame.contentWindow)?.weeklyInputs?.availability || []).length === 0, 'UI: localStorage no longer contains removed availability entries');
    } finally {
      destroyFrame(availabilityReloadFrame);
    }

    doc.getElementById('addAvailabilityBtn').click();
    await waitFor(() => doc.querySelectorAll('#availabilityBody tr').length === 1);
    const infeasibleRow = doc.querySelector('#availabilityBody tr');
    await setFieldValue(infeasibleRow.querySelector('.entry-chef'), 'Brooke');
    await setFieldValue(infeasibleRow.querySelector('.entry-type'), 'Annual Leave');
    await setFieldValue(infeasibleRow.querySelector('.entry-start-date'), '2026-07-20');
    await setFieldValue(infeasibleRow.querySelector('.entry-finish-date'), '2026-07-26');
    await waitFor(() => doc.querySelectorAll('.week-check').length === 2 && getVisibleResultsText(doc).includes('1 week valid · 1 week requires attention.'));
    assert(getVisibleResultsText(doc).includes('1 week valid · 1 week requires attention.'), 'UI: multi-week summary reports valid and affected weeks compactly');
    const weekChecks = [...doc.querySelectorAll('.week-check')];
    assert(weekChecks[0]?.textContent.includes('✓ No problems found'), 'UI: valid weeks show only a compact success line');
    assert(weekChecks[1]?.textContent.includes('issue'), 'UI: failed weeks automatically list their issues in the weekly checks overview');

    doc.querySelector('button[data-results-week-index="1"]').click();
    await waitFor(() => !getWeekPanel(doc, 1)?.classList.contains('hidden'));
    const visibleWeekTwoText = getVisibleResultsText(doc);
    assert(visibleWeekTwoText.includes('Rota could not be generated') && visibleWeekTwoText.includes('cannot place exactly 3 MIO shifts due to availability/unavailability constraints'), 'UI: infeasible weeks immediately show specific failure reasons');
    assert(!visibleWeekTwoText.includes('H015'), 'UI: normal multi-week failure messaging hides hard-rule IDs');
    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.activeWeekHardFailureCount >= 1, 'UI: switching weeks updates the visible issue summary for the selected week');

    infeasibleRow.querySelector('button[data-remove]').click();
    await waitFor(() => doc.querySelectorAll('#availabilityBody tr').length === 0);
    await waitFor(() => doc.querySelectorAll('.week-check').length === 3);
    doc.querySelector('button[data-results-week-index="0"]').click();
    await waitFor(() => !getWeekPanel(doc, 0)?.classList.contains('hidden'));

    doc.getElementById('addAdditionalChefBtn').click();
    await waitFor(() => doc.getElementById('additionalChefModal').classList.contains('open'));
    assert(doc.getElementById('additionalChefDate').max === '2026-08-02', 'UI: additional-chef modal accepts dates in later generated weeks');
    doc.getElementById('additionalChefDate').value = '2026-07-27';
    doc.getElementById('additionalChefCount').value = '2';
    doc.getElementById('saveAdditionalChefBtn').click();
    await wait(150);
    const persistedAfterAdditional = JSON.parse(localStorage.getItem('gtRota.state.v2'));
    assert(persistedAfterAdditional.weeklyInputs.additionalChefRequirements.some((entry) => entry.date === '2026-07-27' && entry.count === 2), 'UI: later-week additional-chef dates persist correctly');

    await setFieldValue(doc.getElementById('numWeeks'), '1');
    await waitFor(() => !doc.querySelector('#resultsWeekSelect'));
    assert(doc.querySelectorAll('table.rota-table').length === 1, 'UI: selecting one week produces the existing one-week result');

    await setFieldValue(doc.getElementById('numWeeks'), '8');
    await waitFor(() => canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.visibleWeekCount === 8);
    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.visibleWeekCount === 8, 'UI: selecting eight weeks produces eight generated week results');
  } finally {
    destroyFrame(canonicalFrame);
  }

  let persistenceFrame = null;
  try {
    persistenceFrame = await loadFrame('../index.html');
    assert(persistenceFrame.contentDocument.getElementById('numWeeks').value === '8', 'UI: changing numWeeks persists after reload');
  } finally {
    destroyFrame(persistenceFrame);
  }

  localStorage.clear();
  let legacyFrame = null;
  try {
    legacyFrame = await loadFrame('../GT%20Rota%20builder.html?from=bookmark#multi');
    await waitFor(() => legacyFrame.contentWindow.location.pathname.endsWith('/index.html'));
    assert(legacyFrame.contentWindow.location.pathname.endsWith('/index.html'), 'UI: legacy URL redirects to index.html');
    assert(legacyFrame.contentWindow.location.search === '?from=bookmark', 'UI: legacy redirect preserves query parameters');
    assert(legacyFrame.contentWindow.location.hash === '#multi', 'UI: legacy redirect preserves hash');
    assert(legacyFrame.contentWindow.__gtRotaBootstrap?.status === 'ok', 'UI: legacy bookmarked URL loads without console errors');
  } finally {
    destroyFrame(legacyFrame);
  }

  localStorage.clear();
  let staffFrame = null;
  let migrationSeedState = null;
  try {
    staffFrame = await loadFrame('../index.html');
    const doc = staffFrame.contentDocument;
    const frameWindow = staffFrame.contentWindow;
    const staffPanel = doc.getElementById('staffList')?.closest('.panel');

    await setFieldValue(doc.getElementById('weekStart'), '2026-07-13');
    await setFieldValue(doc.getElementById('numWeeks'), '1');

    assert(doc.querySelectorAll('#staffList [data-open-chef-id]').length === 10, 'UI: chefs section renders compact chef rows by default');
    assert(normalizeText(doc.getElementById('staffCountLabel').textContent) === '· 10', 'UI: chefs section heading shows the current chef count');
    const staffPanelText = getVisibleTextFromElement(staffPanel);
    assert(!staffPanelText.includes('Weekend rule') && !staffPanelText.includes('Fixed unavailable day'), 'UI: chef rows do not permanently show weekend or fixed-day rules');
    assert(!staffPanelText.includes('Pass 0') && !staffPanelText.includes('Section skills'), 'UI: chef rows do not permanently show skill scores');
    assert(doc.querySelectorAll('#staffList .danger').length === 0, 'UI: remove buttons are hidden from the main chef list');

    const danRow = await openChefEditorByName(doc, 'Dan');
    assert(doc.getElementById('chefModalTitle').textContent === 'Edit chef', 'UI: clicking a chef opens the edit popup');
    assert(normalizeText(doc.getElementById('chefModalSubtitle').textContent) === 'Dan · Chef de Partie', 'UI: the chef popup identifies the selected chef');
    assert(getModalText(doc).includes('Profile') && getModalText(doc).includes('Section suitability') && getModalText(doc).includes('Availability and preferences') && getModalText(doc).includes('Advanced settings'), 'UI: chef popup is organised into clear sections');
    assert(!getModalText(doc).includes('Hierarchy') && !getModalText(doc).includes('Service pace') && !getModalText(doc).includes('Preferred sections'), 'UI: chef popup hides obsolete hierarchy, service pace, and preferred sections fields');
    assert(doc.getElementById('chefNameInput').value === 'Dan', 'UI: chef popup loads the selected chef name');
    assert(doc.getElementById('chefRoleInput').value === 'Chef de Partie', 'UI: chef popup loads the selected chef role');
    assert(doc.getElementById('chefSkillPassInput').value === '2' && doc.getElementById('chefSkillGarnishInput').value === '3', 'UI: chef popup loads the selected chef skill values');
    const passLevelLabels = [...doc.getElementById('chefSkillPassInput').options].map((option) => option.textContent.trim());
    assert(JSON.stringify(passLevelLabels) === JSON.stringify(['Should not cover', 'In training', 'Competent', 'Preferred']), 'UI: each section selector uses the four descriptive section labels');
    assert(!passLevelLabels.some((label) => /^[0-3]$/.test(label)), 'UI: normal section selectors do not display raw numeric levels');

    const danPersistedBeforeCancel = cloneData(getPersistedAppState(frameWindow));
    doc.getElementById('chefNameInput').value = 'Dan Cancel Test';
    doc.getElementById('chefSkillPassInput').value = '1';
    await clickElement(doc.getElementById('cancelChefBtn'));
    await waitFor(() => !getModal(doc).classList.contains('open'));
    assert(JSON.stringify(getPersistedAppState(frameWindow)) === JSON.stringify(danPersistedBeforeCancel), 'UI: cancelling a chef edit leaves staff state unchanged');

    await openChefEditorByName(doc, 'Dan');
    assert(doc.getElementById('chefNameInput').value === 'Dan' && doc.getElementById('chefSkillPassInput').value === '2', 'UI: cancelled chef edits do not leak back into the popup');
    doc.getElementById('chefSkillPassInput').value = '3';
    await clickElement(doc.getElementById('saveChefBtn'));
    await waitFor(() => !getModal(doc).classList.contains('open'));
    const afterDanSave = getPersistedAppState(frameWindow);
    assert(afterDanSave.staff.filter((chef) => chef.name === 'Dan').length === 1, 'UI: saving a chef edit updates the existing chef record once');
    assert(afterDanSave.staff.find((chef) => chef.name === 'Dan')?.skills?.Pass === 3, 'UI: saving a chef edit persists the changed skill value');

    let danReloadFrame = null;
    try {
      danReloadFrame = await loadFrame('../index.html');
      assert(danReloadFrame.contentWindow.localStorage.getItem('gtRota.state.v2').includes('"Pass":3'), 'UI: edited chef skill values persist after reload');
    } finally {
      destroyFrame(danReloadFrame);
    }

    await openChefEditorByName(doc, 'Camilla');
    await setCheckboxValue(frameWindow, doc.getElementById('chefMioEligibleInput'), false);
    await clickElement(doc.getElementById('saveChefBtn'));
    await waitFor(() => !getModal(doc).classList.contains('open'));

    let camillaReloadFrame = null;
    try {
      camillaReloadFrame = await loadFrame('../index.html');
      const persisted = getPersistedAppState(camillaReloadFrame.contentWindow);
      assert(persisted.staff.find((chef) => chef.name === 'Camilla')?.mioEligible === false, 'UI: MIO eligibility changes persist after reload');
    } finally {
      destroyFrame(camillaReloadFrame);
    }

    await clickElement(doc.getElementById('addChefBtn'));
    await waitFor(() => getModal(doc).classList.contains('open'));
    assert(doc.getElementById('chefModalTitle').textContent === 'Add chef' && doc.getElementById('chefDangerZone').classList.contains('hidden'), 'UI: the Add chef button opens the popup in creation mode');

    await setFieldValue(doc.getElementById('chefNameInput'), 'Dan');
    await setFieldValue(doc.getElementById('chefRoleInput'), 'Chef de Partie');
    await clickElement(doc.getElementById('saveChefBtn'));
    await waitFor(() => doc.getElementById('chefFormError').textContent.length > 0);
    assert(doc.getElementById('chefFormError').textContent.includes('unique'), 'UI: duplicate chef names are rejected');

    doc.getElementById('chefNameInput').value = '';
    doc.getElementById('chefNameInput').dispatchEvent(new frameWindow.Event('change', { bubbles: true }));
    await clickElement(doc.getElementById('saveChefBtn'));
    await waitFor(() => doc.getElementById('chefFormError').textContent.length > 0);
    assert(doc.getElementById('chefFormError').textContent.includes('required'), 'UI: empty chef names are rejected');

    await setFieldValue(doc.getElementById('chefNameInput'), 'Test Chef');
    await setFieldValue(doc.getElementById('chefRoleInput'), 'Chef de Partie');
    await setFieldValue(doc.getElementById('chefSkillSauceInput'), '3');
    await setFieldValue(doc.getElementById('chefWeekendRuleInput'), 'Works weekends');
    await setCheckboxValue(frameWindow, doc.querySelector('input[data-preferred-day-off="Monday"]'), true);
    await setCheckboxValue(frameWindow, doc.getElementById('chefMioEligibleInput'), true);
    doc.getElementById('chefAdvancedSection').open = true;
    await clickElement(doc.getElementById('saveChefBtn'));
    await waitFor(() => !getModal(doc).classList.contains('open'));
    assert(getPersistedAppState(frameWindow).staff.filter((chef) => chef.name === 'Test Chef').length === 1, 'UI: adding a valid chef creates one staff record');

    let testChefReloadFrame = null;
    try {
      testChefReloadFrame = await loadFrame('../index.html');
      const persisted = getPersistedAppState(testChefReloadFrame.contentWindow);
      const testChef = persisted.staff.find((chef) => chef.name === 'Test Chef');
      assert(testChef?.weekendRule === 'Works weekends' && testChef?.preferredDaysOff?.includes('Monday') && testChef?.skills?.Sauce === 3, 'UI: chef availability and section-level changes persist after reload');
      assert(!Object.prototype.hasOwnProperty.call(testChef || {}, 'preferredSections') && !Object.prototype.hasOwnProperty.call(testChef || {}, 'hierarchy') && !Object.prototype.hasOwnProperty.call(testChef || {}, 'servicePace'), 'UI: saved chefs do not persist obsolete profile fields');
    } finally {
      destroyFrame(testChefReloadFrame);
    }

    await setFieldValue(doc.getElementById('mioChef'), 'Test Chef');
    doc.getElementById('addAvailabilityBtn').click();
    await waitFor(() => doc.querySelectorAll('#availabilityBody tr').length === 1);
    const tempAvailabilityRow = doc.querySelector('#availabilityBody tr');
    await setFieldValue(tempAvailabilityRow.querySelector('.entry-chef'), 'Test Chef');
    await setFieldValue(tempAvailabilityRow.querySelector('.entry-type'), 'Unavailable');
    await setFieldValue(tempAvailabilityRow.querySelector('.entry-start-date'), '2026-07-13');
    await setFieldValue(tempAvailabilityRow.querySelector('.entry-finish-date'), '2026-07-13');

    await openChefEditorByName(doc, 'Test Chef');
    await setFieldValue(doc.getElementById('chefNameInput'), 'Test Chef Renamed');
    await clickElement(doc.getElementById('saveChefBtn'));
    await waitFor(() => !getModal(doc).classList.contains('open'));
    const renamedState = getPersistedAppState(frameWindow);
    assert(renamedState.staff.filter((chef) => chef.name === 'Test Chef Renamed').length === 1, 'UI: renaming a chef does not create a duplicate record');
    assert(renamedState.weeklyInputs.mioChef === 'Test Chef Renamed', 'UI: renaming a chef safely updates current MIO references');
    assert((renamedState.weeklyInputs.availability || []).some((entry) => entry.chef === 'Test Chef Renamed'), 'UI: renaming a chef safely updates current availability references');

    await openChefEditorByName(doc, 'Aled');
    const aledRowSelector = '[data-open-chef-id="chef-aled-1"]';
    doc.getElementById('saveChefBtn').focus();
    doc.dispatchEvent(new frameWindow.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await wait(100);
    assert(doc.activeElement.id === 'chefNameInput', 'UI: chef modal traps keyboard focus');
    doc.dispatchEvent(new frameWindow.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !getModal(doc).classList.contains('open'));
    assert(!getModal(doc).classList.contains('open'), 'UI: Escape closes a normal chef popup');
    await waitFor(() => doc.activeElement === doc.querySelector(aledRowSelector));
    assert(doc.activeElement === doc.querySelector(aledRowSelector), 'UI: focus returns to the triggering chef row after closing the popup');

    await openChefEditorByName(doc, 'Test Chef Renamed');
    assert(!doc.getElementById('chefDangerZone').classList.contains('hidden') && !!doc.getElementById('removeChefBtn'), 'UI: remove chef is available only inside the chef popup');
    await clickElement(doc.getElementById('removeChefBtn'));
    await waitFor(() => !doc.getElementById('chefRemoveConfirmation').classList.contains('hidden'));
    assert(getModalText(doc).includes('Remove Test Chef Renamed from the staff list?'), 'UI: the first remove click opens a named confirmation step');
    await clickElement(doc.getElementById('cancelRemoveChefBtn'));
    await waitFor(() => doc.getElementById('chefRemoveConfirmation').classList.contains('hidden'));
    assert(!![...doc.querySelectorAll('#staffList [data-open-chef-id]')].find((button) => normalizeText(button.textContent).includes('Test Chef Renamed')), 'UI: cancelling chef removal keeps the chef in the list');
    await clickElement(doc.getElementById('removeChefBtn'));
    await waitFor(() => !doc.getElementById('chefRemoveConfirmation').classList.contains('hidden'));
    await clickElement(doc.getElementById('confirmRemoveChefBtn'));
    await waitFor(() => ![...doc.querySelectorAll('#staffList [data-open-chef-id]')].find((button) => normalizeText(button.textContent).includes('Test Chef Renamed')));
    const afterRemovalState = getPersistedAppState(frameWindow);
    assert(afterRemovalState.staff.filter((chef) => chef.name === 'Test Chef Renamed').length === 0, 'UI: confirming removal deletes only the selected chef');
    assert(afterRemovalState.weeklyInputs.mioChef !== 'Test Chef Renamed', 'UI: removing the selected MIO chef clears or safely replaces the invalid MIO selection');
    assert(!(afterRemovalState.weeklyInputs.availability || []).some((entry) => entry.chef === 'Test Chef Renamed'), 'UI: removing a chef cleans up current availability references without crashing rendering');

    staffFrame.style.width = '390px';
    staffFrame.style.height = '900px';
    await wait(200);
    await openChefEditorByName(doc, 'Dan');
    const modalCard = doc.querySelector('.chef-modal-card');
    assert(modalCard.scrollWidth <= modalCard.clientWidth, 'UI: mobile chef modal layout avoids horizontal overflow');
    await clickElement(doc.getElementById('cancelChefBtn'));

    migrationSeedState = cloneData(getPersistedAppState(frameWindow));
  } finally {
    destroyFrame(staffFrame);
  }

  localStorage.clear();
  localStorage.setItem('gtRota.schemaVersion', '5');
  const legacyStaffState = cloneData(migrationSeedState);
  let migratedSnapshot = null;
  legacyStaffState.staff = legacyStaffState.staff.map((chef) => ({
    ...chef,
    hierarchy: 4,
    servicePace: 'steady',
    preferredSections: Object.entries(chef.skills || {}).filter(([, level]) => level === 3).map(([section]) => section)
  }));
  legacyStaffState.weeklyInputs.availability = [
    { chef: 'Dan', type: 'Annual Leave', startDate: '2026-07-13', finishDate: '2026-07-16', notes: 'Migrated leave' },
    { chef: 'Connor', type: 'Unavailable', startDate: '2026-07-17', finishDate: '2026-07-17', notes: 'Migrated unavailable' }
  ];
  localStorage.setItem('gtRota.state.v2', JSON.stringify(legacyStaffState));
  let migrationFrame = null;
  try {
    migrationFrame = await loadFrame('../index.html');
    const migratedState = getPersistedAppState(migrationFrame.contentWindow);
    migratedSnapshot = cloneData(migratedState);
    const ids = migratedState.staff.map((chef) => chef.id).filter(Boolean);
    assert(ids.length === migratedState.staff.length && new Set(ids).size === ids.length, 'UI: existing staff records migrate to stable chef IDs');
    assert(migratedState.staff.find((chef) => chef.name === 'Dan')?.skills?.Pass === legacyStaffState.staff.find((chef) => chef.name === 'Dan')?.skills?.Pass, 'UI: staff migration preserves existing skill values');
    assert(migratedState.staff.every((chef) => !Object.prototype.hasOwnProperty.call(chef, 'hierarchy') && !Object.prototype.hasOwnProperty.call(chef, 'servicePace') && !Object.prototype.hasOwnProperty.call(chef, 'preferredSections')), 'UI: schema migration removes hierarchy, service pace, and preferred sections');
    assert(migratedState.staff.find((chef) => chef.name === 'Dan')?.id === legacyStaffState.staff.find((chef) => chef.name === 'Dan')?.id, 'UI: schema migration preserves stable chef IDs');
    assert(migratedState.staff.find((chef) => chef.name === 'Charlie')?.role === legacyStaffState.staff.find((chef) => chef.name === 'Charlie')?.role && migratedState.staff.find((chef) => chef.name === 'Charlie')?.seniorStatus === legacyStaffState.staff.find((chef) => chef.name === 'Charlie')?.seniorStatus, 'UI: schema migration preserves roles and senior status');
    assert(migratedState.staff.find((chef) => chef.name === 'Camilla')?.mioEligible === legacyStaffState.staff.find((chef) => chef.name === 'Camilla')?.mioEligible, 'UI: schema migration preserves MIO eligibility');
    assert(JSON.stringify(migratedState.weeklyInputs.availability) === JSON.stringify(legacyStaffState.weeklyInputs.availability), 'UI: schema migration preserves annual leave and unavailable entries');
    assert(migrationFrame.contentWindow.localStorage.getItem('gtRota.schemaVersion') === '6', 'UI: storage schema version increments to 6');
  } finally {
    destroyFrame(migrationFrame);
  }

  let migrationReloadFrame = null;
  try {
    migrationReloadFrame = await loadFrame('../index.html');
    assert(JSON.stringify(getPersistedAppState(migrationReloadFrame.contentWindow)) === JSON.stringify(migratedSnapshot), 'UI: schema migration is idempotent across reloads');
  } finally {
    destroyFrame(migrationReloadFrame);
  }

  localStorage.clear();
  const singleChefState = cloneData(migrationSeedState);
  singleChefState.staff = [cloneData(singleChefState.staff.find((chef) => chef.name === 'Dan'))];
  singleChefState.staff[0].name = 'History Chef';
  singleChefState.staff[0].id = 'chef-history-1';
  singleChefState.staff[0].mioEligible = true;
  singleChefState.weeklyInputs.mioChef = 'History Chef';
  singleChefState.weeklyInputs.weeklyMioSelections = { [singleChefState.weeklyInputs.weekStart]: 'History Chef' };
  singleChefState.weeklyInputs.availability = [{ chef: 'History Chef', type: 'Unavailable', startDate: singleChefState.weeklyInputs.weekStart, finishDate: singleChefState.weeklyInputs.weekStart, notes: '' }];
  localStorage.setItem('gtRota.schemaVersion', String(6));
  localStorage.setItem('gtRota.state.v2', JSON.stringify(singleChefState));
  localStorage.setItem('gtRota.history.v1', JSON.stringify([{
    key: '2026-07-13__History Chef',
    weekStart: '2026-07-13',
    chef: 'History Chef',
    gtDays: 4,
    mioDays: 0,
    hours: 48,
    breakfasts: 0,
    fridayWorked: false,
    saturdayWorked: false,
    sundayWorked: false,
    publishedAt: '2026-07-17T00:00:00.000Z'
  }]));
  let emptyStateFrame = null;
  try {
    emptyStateFrame = await loadFrame('../index.html');
    const doc = emptyStateFrame.contentDocument;
    await openChefEditorByName(doc, 'History Chef');
    await clickElement(doc.getElementById('removeChefBtn'));
    await waitFor(() => !doc.getElementById('chefRemoveConfirmation').classList.contains('hidden'));
    await clickElement(doc.getElementById('confirmRemoveChefBtn'));
    await waitFor(() => normalizeText(doc.getElementById('staffList').textContent).includes('No chefs have been added.'));
    assert(normalizeText(doc.getElementById('staffList').textContent).includes('No chefs have been added.'), 'UI: the empty chefs state appears after the final chef is removed');
    assert(!!doc.querySelector('[data-open-chef-create]'), 'UI: Add chef remains available in the empty state');
    assert(JSON.parse(localStorage.getItem('gtRota.history.v1')).some((entry) => entry.chef === 'History Chef'), 'UI: published historical rota snapshots remain readable after a chef is removed');
    await clickElement(doc.querySelector('[data-open-chef-create]'));
    await waitFor(() => getModal(doc).classList.contains('open'));
    assert(doc.getElementById('chefModalTitle').textContent === 'Add chef', 'UI: the empty-state Add chef action still opens creation mode');
  } finally {
    destroyFrame(emptyStateFrame);
  }
}
