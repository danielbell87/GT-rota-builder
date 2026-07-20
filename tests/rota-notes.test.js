import { getState, resetStateToDefaults, setManualDailyNote } from '../js/state.js';
import { composeDateNotes, normalizeManualDailyNotes } from '../js/rota-notes.js';
import { addAdditionalChefRequest, updateAdditionalChefRequest } from '../js/weekly-inputs.js';
import { buildPrintModel, renderPrintDocument } from '../js/print.js?v=20260720notes';
import { loadAppState, saveAppState, STORAGE_KEYS } from '../js/storage.js?v=20260720notes';

function inputs(overrides = {}) {
  return {
    additionalChefRequirements: [],
    availability: [],
    manualDailyNotes: {},
    ...overrides
  };
}

function printableWeek(inputOverrides = {}) {
  const start = new Date('2026-07-13T00:00:00');
  return {
    weekStart: '2026-07-13',
    status: 'ok',
    inputs: inputs(inputOverrides),
    hardValidation: [],
    diagnostics: [],
    rota: Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      return {
        date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
        dayName: date.toLocaleDateString('en-GB', { weekday: 'long' }),
        assignments: []
      };
    })
  };
}

export async function runRotaNotesTests(assert) {
  assert(composeDateNotes('2026-07-13', inputs()).length === 0, 'Notes: an empty date stays blank without placeholder content');
  assert(composeDateNotes('2026-07-13', inputs({ additionalChefRequirements: [{ date: '2026-07-13', count: 1 }] }))[0].text === '1 additional chef required', 'Notes: singular additional-chef wording works without a reason');
  assert(composeDateNotes('2026-07-13', inputs({ additionalChefRequirements: [{ date: '2026-07-13', count: 2, note: 'Wedding prep' }] }))[0].text === '2 additional chefs required: Wedding prep', 'Notes: plural additional-chef wording includes its optional reason');

  const holiday = { chef: 'Adam', type: 'Annual Leave', startDate: '2026-07-16', finishDate: '2026-07-22', notes: 'Private' };
  assert(composeDateNotes('2026-07-19', inputs({ availability: [holiday] }))[0].text === 'Adam on holiday, day 4 of 7', 'Notes: holiday progress uses the complete continuous saved range');
  assert(composeDateNotes('2026-07-20', inputs({ availability: [holiday] }))[0].text === 'Adam on holiday, day 5 of 7', 'Notes: holiday progress continues correctly into the next rota week');
  const separate = [
    { chef: 'Adam', type: 'Annual Leave', startDate: '2026-07-13', finishDate: '2026-07-14' },
    { chef: 'Adam', type: 'Annual Leave', startDate: '2026-07-16', finishDate: '2026-07-17' }
  ];
  assert(composeDateNotes('2026-07-16', inputs({ availability: separate }))[0].text === 'Adam on holiday, day 1 of 2', 'Notes: separate leave requests are not incorrectly merged');
  const availability = [
    holiday,
    { chef: 'Connor', type: 'Unavailable', startDate: '2026-07-19', finishDate: '2026-07-19', notes: 'Private reason' }
  ];
  const availabilityLines = composeDateNotes('2026-07-19', inputs({ availability }));
  assert(availabilityLines.length === 2 && availabilityLines[1].text === 'Connor unavailable', 'Notes: multiple availability entries render separately with private reasons omitted');

  const ordered = composeDateNotes('2026-07-19', inputs({
    additionalChefRequirements: [{ date: '2026-07-19', count: 1, note: 'Wedding prep' }],
    availability,
    manualDailyNotes: { '2026-07-19': 'Move delivery to rear entrance' }
  }));
  assert(ordered.map((line) => line.type).join(',') === 'additional,holiday,unavailable,manual', 'Notes: entries use additional, availability, then manual order');
  assert(ordered.at(-1).text === 'Move delivery to rear entrance', 'Notes: manual text displays without an added prefix');
  assert(JSON.stringify(normalizeManualDailyNotes({ '2026-07-19': '  Keep this  ', bad: 'Drop', '2026-07-20': '   ' })) === JSON.stringify({ '2026-07-19': 'Keep this' }), 'Notes: manual-note normalization trims text and keeps only stable date keys');

  resetStateToDefaults();
  const state = getState();
  addAdditionalChefRequest('2026-07-19', 1, 'Wedding prep');
  assert(state.weeklyInputs.additionalChefRequirements[0].note === 'Wedding prep', 'Notes: additional-chef reason remains on the existing request record');
  updateAdditionalChefRequest('2026-07-19', '2026-07-20', 2, 'Large party');
  assert(state.weeklyInputs.additionalChefRequirements.length === 1 && state.weeklyInputs.additionalChefRequirements[0].note === 'Large party', 'Notes: editing a request updates its linked reason without duplication');
  setManualDailyNote('2026-07-19', '  First note  ');
  setManualDailyNote('2026-07-20', 'Second note');
  assert(state.weeklyInputs.manualDailyNotes['2026-07-19'] === 'First note' && state.weeklyInputs.manualDailyNotes['2026-07-20'] === 'Second note', 'Notes: manual notes are keyed to calendar dates');
  setManualDailyNote('2026-07-19', '');
  assert(!Object.prototype.hasOwnProperty.call(state.weeklyInputs.manualDailyNotes, '2026-07-19'), 'Notes: clearing text removes the manual note instead of storing an empty value');

  const originalStored = localStorage.getItem(STORAGE_KEYS.appState);
  state.weeklyInputs.manualDailyNotes = { '2026-07-20': 'Persist me' };
  saveAppState(state);
  resetStateToDefaults();
  loadAppState();
  assert(getState().weeklyInputs.manualDailyNotes['2026-07-20'] === 'Persist me', 'Notes: manual notes survive state save and restore');
  if (originalStored === null) {
    localStorage.removeItem(STORAGE_KEYS.appState);
    resetStateToDefaults();
  } else {
    localStorage.setItem(STORAGE_KEYS.appState, originalStored);
    loadAppState();
  }

  const unsafe = '<img src=x onerror=alert(1)>';
  const printModel = buildPrintModel({ weeks: [printableWeek({
    manualDailyNotes: { '2026-07-13': unsafe },
    additionalChefRequirements: [{ date: '2026-07-13', count: 1 }]
  })] });
  const printHtml = renderPrintDocument(printModel);
  assert(printModel.weeks[0].days[0].notes.length === 2 && printModel.weeks[0].days[1].notes.length === 0, 'Notes: print model associates notes with the correct date and leaves other dates blank');
  assert(printHtml.includes('class="print-notes-row"') && printHtml.includes('>Notes</th>'), 'Notes: printable rota includes a Notes row beneath section rows');
  assert(printHtml.includes('&lt;img src=x onerror=alert(1)&gt;') && !printHtml.includes(unsafe), 'Notes: manual text is safely escaped in print output');
  assert(!printHtml.includes('data-edit-daily-note') && !printHtml.includes('Edit note'), 'Notes: print output contains no editing controls or hover prompts');
  assert(!printHtml.includes('preference') && !printHtml.includes('fairness') && !printHtml.includes('validation'), 'Notes: composed print row contains no forbidden automated note types');
}
