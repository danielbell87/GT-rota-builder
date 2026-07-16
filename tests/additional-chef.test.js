import { getState, resetStateToDefaults, syncCompatibilityViews } from '../js/state.js';
import { buildMultiWeekRota, buildRota } from '../js/solver.js';
import {
  addAdditionalChefRequest,
  updateAdditionalChefRequest,
  removeAdditionalChefRequest,
  validateAdditionalChefDate,
  validateAdditionalChefDateForHorizon,
  validateAdditionalChefCount
} from '../js/weekly-inputs.js';

const WEEK_START = '2026-07-13';
const WEEK_ONE_REQUEST_DATE = '2026-07-17';
const WEEK_TWO_REQUEST_DATE = '2026-07-24';

function setupBaseState() {
  localStorage.clear();
  resetStateToDefaults();
  const state = getState();
  state.weeklyInputs.weekStart = WEEK_START;
  state.weeklyInputs.mioChef = 'Dan';
  state.weeklyInputs.mioSelectionsByWeek = {
    '2026-07-13': 'Dan',
    '2026-07-20': 'Fred'
  };
  state.weeklyInputs.numWeeks = 2;
  state.weeklyInputs.availability = [];
  state.weeklyInputs.dailyOverrides = {};
  state.weeklyInputs.additionalChefRequirements = [];
  syncCompatibilityViews();
  return state;
}

export async function runAdditionalChefTests(assert) {
  const state = setupBaseState();

  assert(validateAdditionalChefDate('2026-07-12', WEEK_START) !== '', 'Additional-chef date before selected week is rejected');
  assert(validateAdditionalChefDate(WEEK_ONE_REQUEST_DATE, WEEK_START) === '', 'Additional-chef date inside single-week range is accepted');
  assert(validateAdditionalChefDateForHorizon(WEEK_TWO_REQUEST_DATE, WEEK_START, 2) === '', 'Additional-chef date inside later selected week is accepted');
  assert(validateAdditionalChefDateForHorizon('2026-07-28', WEEK_START, 2) !== '', 'Additional-chef date after planning horizon is rejected');

  assert(validateAdditionalChefCount('1') === '', 'Quantity of 1 is accepted');
  assert(validateAdditionalChefCount('0') !== '', 'Quantity of 0 is rejected');
  assert(validateAdditionalChefCount('6') !== '', 'Quantity above maximum is rejected');

  addAdditionalChefRequest(WEEK_ONE_REQUEST_DATE, 2);
  assert(state.weeklyInputs.additionalChefRequirements.length === 1, 'Adding an additional-chef request creates one record');
  updateAdditionalChefRequest(WEEK_ONE_REQUEST_DATE, WEEK_TWO_REQUEST_DATE, 3);
  assert(state.weeklyInputs.additionalChefRequirements.length === 1, 'Editing an additional-chef request does not duplicate records');
  assert(state.weeklyInputs.additionalChefRequirements[0].date === WEEK_TWO_REQUEST_DATE, 'Editing an additional-chef request can move it to a later week');
  removeAdditionalChefRequest(WEEK_TWO_REQUEST_DATE);
  assert(state.weeklyInputs.additionalChefRequirements.length === 0, 'Removing an additional-chef request clears it');

  state.weeklyInputs.additionalChefRequirements = [{ date: WEEK_TWO_REQUEST_DATE, count: 2 }];
  const multiWeek = buildMultiWeekRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    mioSelectionsByWeek: state.weeklyInputs.mioSelectionsByWeek,
    additionalChefRequirements: state.weeklyInputs.additionalChefRequirements,
    availability: state.weeklyInputs.availability
  }, 2);
  assert(multiWeek.status === 'ok', 'Multi-week solver accepts later-week additional-chef requests');
  const weekTwoFriday = multiWeek.weeks[1].rota.find((day) => day.date === WEEK_TWO_REQUEST_DATE);
  assert(new Set(weekTwoFriday.chefs).size === 7, 'Additional-chef requests work in later weeks');

  state.weeklyInputs.additionalChefRequirements = [{ date: WEEK_ONE_REQUEST_DATE, count: 1 }];
  const singleWeek = buildRota({
    weekStart: state.weeklyInputs.weekStart,
    mioChef: state.weeklyInputs.mioChef,
    additionalChefRequirements: state.weeklyInputs.additionalChefRequirements,
    availability: state.weeklyInputs.availability
  });
  const friday = singleWeek.rota.find((day) => day.date === WEEK_ONE_REQUEST_DATE);
  assert(new Set(friday.chefs).size === 6, 'Single-week additional-chef requests still adjust staffing on the exact date');
}
