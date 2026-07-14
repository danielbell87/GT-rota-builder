export function normalizeHistoryKey(weekStart, chef) {
  return `${weekStart}__${chef}`;
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
      const hasChef = day.assignments.some((a) => a.chef === item.name);
      if (!hasChef) return;
      if (weekends[day.dayName] !== undefined) weekends[day.dayName] = true;
      if (day.assignments.some((a) => a.chef === item.name && a.section === 'Breakfast')) breakfasts += 1;
      if (day.assignments.some((a) => a.chef === item.name && a.section === 'MIO')) mioDays += 1;
    });

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
      publishedAt: new Date().toISOString()
    };

    const index = nextHistory.findIndex((entry) => entry.key === key);
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
