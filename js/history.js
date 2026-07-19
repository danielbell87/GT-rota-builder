import { hasGtAssignment } from './rota-model.js?v=20260719zf';

export function normalizeHistoryKey(weekStart, chef) {
  return `${weekStart}__${chef}`;
}

function getWeekendDate(weekStart, offset) {
  const date = new Date(`${weekStart}T00:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function upsertPublishedHistory(state, weekStart, rota, summary) {
  if (state.weeklyInputs.status !== 'Published') return { updated: 0, inserted: 0 };

  const nextHistory = state.history.slice();
  let updated = 0;
  let inserted = 0;

  summary.forEach((item) => {
    const key = normalizeHistoryKey(weekStart, item.name);
    const weekends = { Friday: false, Saturday: false, Sunday: false };
    let breakfasts = 0;
    let mioDays = 0;

    rota.forEach((day) => {
      const hasChef = hasGtAssignment(day, item.name);
      if (hasChef && weekends[day.dayName] !== undefined) weekends[day.dayName] = true;
      if (day.assignments.some((a) => a.chef === item.name && a.section === 'Breakfast')) breakfasts += 1;
      if (day.assignments.some((a) => a.chef === item.name && a.section === 'MIO')) mioDays += 1;
    });
    const weekendDates = {
      Friday: getWeekendDate(weekStart, 4),
      Saturday: getWeekendDate(weekStart, 5),
      Sunday: getWeekendDate(weekStart, 6)
    };
    const unavailableWeekendDays = new Set();
    (state.weeklyInputs.availability || [])
      .filter((entry) => entry.chef === item.name)
      .forEach((entry) => {
        Object.entries(weekendDates).forEach(([dayName, date]) => {
          if (entry.startDate <= date && entry.finishDate >= date) unavailableWeekendDays.add(dayName);
        });
      });
    const satSunBlock = !weekends.Saturday && !weekends.Sunday
      && !unavailableWeekendDays.has('Saturday') && !unavailableWeekendDays.has('Sunday');
    const friSatBlock = !weekends.Friday && !weekends.Saturday
      && !unavailableWeekendDays.has('Friday') && !unavailableWeekendDays.has('Saturday')
      && !satSunBlock;

    const record = {
      key,
      weekStart,
      chef: item.name,
      gtDays: item.count,
      mioDays,
      hours: item.hours,
      breakfasts,
      fridayWorked: weekends.Friday,
      saturdayWorked: weekends.Saturday,
      sundayWorked: weekends.Sunday,
      earnedWeekendBlock: satSunBlock || friSatBlock,
      weekendBlockType: satSunBlock ? 'sat-sun' : (friSatBlock ? 'fri-sat' : ''),
      publishedAt: new Date().toISOString()
    };

    const index = nextHistory.findIndex((entry) => entry.key === key
      || (entry.weekStart === weekStart && entry.chef === item.name));
    if (index >= 0) {
      nextHistory[index] = { ...nextHistory[index], ...record };
      updated += 1;
    } else {
      nextHistory.push(record);
      inserted += 1;
    }
  });

  state.history = nextHistory;
  return { updated, inserted };
}

export function upsertPublishedWeeks(state, weeks) {
  if (state.weeklyInputs.status !== 'Published') return { updated: 0, inserted: 0 };
  const originalHistory = state.history;
  let updated = 0;
  let inserted = 0;
  try {
    (weeks || []).forEach((week) => {
      if (week?.status !== 'ok') throw new Error('Cannot publish an incomplete multi-week rota.');
      const result = upsertPublishedHistory(state, week.weekStart, week.rota, week.summary);
      updated += result.updated;
      inserted += result.inserted;
    });
    return { updated, inserted };
  } catch (error) {
    state.history = originalHistory;
    throw error;
  }
}
