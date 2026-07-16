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

async function setFieldValue(element, value) {
  element.value = value;
  element.dispatchEvent(new Event('change', { bubbles: true }));
  await wait(150);
}

export async function runUiTests(assert) {
  localStorage.clear();
  const stateModule = await import('../js/state.js');
  const appSource = await fetch('../js/app.js?v=20260716b').then((response) => response.text());
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
    await setFieldValue(doc.getElementById('weekStart'), '2026-07-13');
    await setFieldValue(doc.getElementById('numWeeks'), '3');
    await waitFor(() => doc.querySelectorAll('select[data-weekly-mio-start]').length === 3);

    assert(doc.querySelectorAll('section[data-week-panel]').length === 3, 'UI: selecting three weeks produces three generated week results');
    assert(doc.querySelectorAll('select[data-weekly-mio-start]').length === 3, 'UI: three weeks display three MIO selectors');
    assert(canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.mode === 'multi', 'UI: multi-week rendering does not call only buildRota()');

    const weeklySelectors = [...doc.querySelectorAll('select[data-weekly-mio-start]')];
    await setFieldValue(weeklySelectors[0], 'Dan');
    await setFieldValue(weeklySelectors[1], 'Fred');
    await setFieldValue(weeklySelectors[2], 'Joel');
    assert(JSON.stringify(canonicalFrame.contentWindow.__gtRotaBootstrap?.lastRender?.weekMioChefs) === JSON.stringify(['Dan', 'Fred', 'Joel']), 'UI: different MIO chefs are passed to different weeks');

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
}
