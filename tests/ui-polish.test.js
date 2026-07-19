import { buildWeekClipboardText, getWeekLifecycle, icon } from '../js/ui.js?v=20260719u';

export async function runUiPolishTests(assert) {
  const week = {
    weekStart: '2026-07-13', status: 'ok', hardValidation: [],
    rota: [{ dayName: 'Monday', date: '2026-07-13', assignments: [
      { section: 'Sauce', chef: 'Adam' }, { section: 'Float', chef: 'Dan' }, { section: 'Float', chef: 'Myles' }, { section: 'MIO', chef: 'Fred' }
    ] }]
  };
  const state = { generatedRotas: { latestResult: { weeks: [week] } }, manualEditing: { edits: {} }, history: [] };
  assert(getWeekLifecycle(state, 0) === 'Generated', 'UI lifecycle: fresh result is Generated');
  state.manualEditing.edits['2026-07-13__2026-07-13__Sauce'] = 'Adam';
  assert(getWeekLifecycle(state, 0) === 'Manually adjusted', 'UI lifecycle: a scoped edit is Manually adjusted');
  const text = buildWeekClipboardText({ state, overallResult: state.generatedRotas.latestResult, weekIndex: 0 });
  assert(text.includes('Monday 13 Jul 2026') && text.includes('Float: Dan, Myles') && text.includes('MIO: Fred'), 'Copy week: date, multiple Float chefs and MIO are included');
  assert(text.includes('Pass:') && !text.includes('None'), 'Copy week: every section is present and blank assignments never say None');
  assert(text.includes('Manually adjusted'), 'Copy week: lifecycle note is included');
  assert(icon('print').includes('<svg') && icon('print').includes('aria-hidden="true"'), 'Icon system: decorative SVG output is consistently hidden from assistive technology');
}
