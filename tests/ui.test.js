import { CACHE_BUST_VERSION } from '../js/constants.js';

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
  frame.style.width = '390px';
  frame.style.height = '900px';
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

async function setFrameSize(frame, width, height = 1200) {
  frame.style.width = `${width}px`;
  frame.style.height = `${height}px`;
  await wait(150);
}

async function setFieldValue(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(150);
}

function isVisible(win, element) {
  if (!element) return false;
  const style = win.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && !element.hidden;
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

  let canonicalFrame = null;
  try {
    canonicalFrame = await loadFrame('../index.html');
    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.status === 'ok', 'UI: fresh application import completes without module errors');
    assert(canonicalFrame.contentWindow.location.pathname.endsWith('/index.html'), 'UI: canonical URL loads successfully');
    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.status === 'ok', 'UI: canonical URL loads without console errors');

    const doc = canonicalFrame.contentDocument;
    await setFrameSize(canonicalFrame, 390, 1400);
    await setFieldValue(doc.getElementById('weekStart'), '2026-07-20');
    await setFieldValue(doc.getElementById('numWeeks'), '4');
    await waitFor(() => doc.querySelectorAll('select[data-weekly-mio-start]').length === 4);

    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.storedWeekCount === 4, 'UI: selecting four weeks stores four generated week results');
    assert(doc.querySelectorAll('section[data-week-panel]').length === 4, 'UI: selecting four weeks creates four result panels in the DOM');
    assert(doc.querySelectorAll('select[data-weekly-mio-start]').length === 4, 'UI: four weeks display four MIO selectors');
    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.mode === 'multi', 'UI: multi-week rendering does not call only buildRota()');

    const weeklySelectors = [...doc.querySelectorAll('select[data-weekly-mio-start]')];
    await setFieldValue(weeklySelectors[0], 'Dan');
    await setFieldValue(weeklySelectors[1], 'Fred');
    await setFieldValue(weeklySelectors[2], 'Joel');
    await setFieldValue(weeklySelectors[3], 'Camilla');
    assert(JSON.stringify(canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.weekMioChefs) === JSON.stringify(['Dan', 'Fred', 'Joel', 'Camilla']), 'UI: different MIO chefs are passed to different weeks');

    const getVisiblePanels = () => [...doc.querySelectorAll('section[data-week-panel]')].filter((panel) => !panel.hidden);
    const getViewingLabel = () => doc.querySelector('.week-navigation-title');
    const getViewingMeta = () => [...doc.querySelectorAll('.week-navigation-meta')];
    const getPreviousWeekButton = () => doc.querySelector('button[data-results-week-previous]');
    const getNextWeekButton = () => doc.querySelector('button[data-results-week-next]');
    const getMobileWeekLabel = () => doc.querySelector('.results-week-select-label');
    const getMobileWeekSelect = () => doc.getElementById('resultsWeekSelect');
    const getWeekTabs = () => doc.querySelector('.week-tabs');
    const initialBuildMultiWeekCalls = canonicalFrame.contentWindow.__gtRotaBootstrap?.metrics?.buildMultiWeekCalls || 0;
    const firstWeekAssignments = doc.querySelector('#results-week-panel-0 .rota-table')?.innerHTML;

    assert(getVisiblePanels().length === 1, 'UI: exactly one result panel is visible by default');
    assert(getViewingLabel()?.textContent?.trim() === 'Viewing Week 1 of 4', 'UI: navigation says “Viewing Week 1 of 4” by default');
    assert(getPreviousWeekButton()?.disabled === true, 'UI: previous week is disabled on Week 1');
    assert(isVisible(canonicalFrame.contentWindow, getMobileWeekLabel()), 'UI: mobile CSS displays the week dropdown');
    assert((getMobileWeekSelect()?.clientWidth || 0) >= ((getMobileWeekLabel()?.clientWidth || 0) - 2), 'UI: mobile week dropdown is full width');

    await setFieldValue(getMobileWeekSelect(), '1');
    await waitFor(() => canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.currentWeekIndex === 1);
    assert(getViewingLabel()?.textContent?.trim() === 'Viewing Week 2 of 4', 'UI: selecting Week 2 updates the viewing label');
    assert(getViewingMeta()[0]?.textContent?.includes('27 July – 2 August 2026'), 'UI: selecting Week 2 displays Week 2 dates');
    assert(getViewingMeta()[1]?.textContent?.includes('Fred'), 'UI: selecting Week 2 displays Week 2 MIO chef');
    assert(doc.querySelector('#results-week-panel-0')?.hidden === true, 'UI: Week 1 becomes hidden when Week 2 is selected');
    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.currentWeekStart === '2026-07-27', 'UI: state.generatedRotas.current follows the selected week');
    assert((canonicalFrame.contentWindow.__gtRotaBootstrap?.metrics?.buildMultiWeekCalls || 0) === initialBuildMultiWeekCalls, 'UI: switching weeks does not rerun buildMultiWeekRota()');

    getNextWeekButton()?.click();
    await waitFor(() => canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.currentWeekIndex === 2);
    assert(getViewingLabel()?.textContent?.trim() === 'Viewing Week 3 of 4', 'UI: next week button advances to the next generated rota');

    getNextWeekButton()?.click();
    await waitFor(() => canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.currentWeekIndex === 3);
    assert(getNextWeekButton()?.disabled === true, 'UI: next week is disabled on the final week');

    getPreviousWeekButton()?.click();
    await waitFor(() => canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.currentWeekIndex === 2);
    assert(getViewingLabel()?.textContent?.trim() === 'Viewing Week 3 of 4', 'UI: previous week button works');

    doc.querySelector('button[data-results-week-index="0"]')?.click();
    await waitFor(() => canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.currentWeekIndex === 0);
    assert(doc.querySelector('#results-week-panel-0 .rota-table')?.innerHTML === firstWeekAssignments, 'UI: switching weeks does not alter assignments');

    doc.querySelector('button[data-results-view-all]')?.click();
    await waitFor(() => canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.showAllWeeks === true);
    assert(getVisiblePanels().length === 4, 'UI: view all weeks displays every generated rota');

    doc.querySelector('button[data-results-view-one]')?.click();
    await waitFor(() => canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.showAllWeeks === false);
    assert(getVisiblePanels().length === 1, 'UI: view one week at a time returns to compact mode');

    await setFrameSize(canonicalFrame, 1280, 1400);
    assert(isVisible(canonicalFrame.contentWindow, getWeekTabs()), 'UI: desktop CSS displays week tabs');

    for (const width of [390, 768, 1280]) {
      await setFrameSize(canonicalFrame, width, 1400);
      const visibleNavMethods = [
        isVisible(canonicalFrame.contentWindow, getMobileWeekLabel()),
        isVisible(canonicalFrame.contentWindow, getWeekTabs()),
        isVisible(canonicalFrame.contentWindow, doc.querySelector('.week-navigation-controls'))
      ].filter(Boolean).length;
      assert(visibleNavMethods >= 1, `UI: at least one navigation method is visible at viewport width ${width}`);
    }

    doc.getElementById('addAdditionalChefBtn').click();
    await waitFor(() => doc.getElementById('additionalChefModal').classList.contains('open'));
    assert(doc.getElementById('additionalChefDate').max === '2026-08-16', 'UI: additional-chef modal accepts dates in later generated weeks');
    doc.getElementById('additionalChefDate').value = '2026-07-27';
    doc.getElementById('additionalChefCount').value = '2';
    doc.getElementById('saveAdditionalChefBtn').click();
    await wait(150);
    const persistedAfterAdditional = JSON.parse(localStorage.getItem('gtRota.state.v2'));
    assert(persistedAfterAdditional.weeklyInputs.additionalChefRequirements.some((entry) => entry.date === '2026-07-27' && entry.count === 2), 'UI: later-week additional-chef dates persist correctly');

    const styles = await fetch(new URL('../styles.css', import.meta.url)).then((response) => response.text());
    assert(styles.includes('@media print') && styles.includes('.week-panel[hidden]') && styles.includes('break-before: page'), 'UI: print mode includes every generated week');

    await setFieldValue(doc.getElementById('numWeeks'), '1');
    await waitFor(() => !doc.querySelector('#resultsWeekSelect'));
    assert(doc.querySelectorAll('table.rota-table').length === 1, 'UI: selecting one week produces the existing one-week result');
    assert(!doc.querySelector('.week-navigation-panel'), 'UI: one-week mode remains unchanged');

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
}
