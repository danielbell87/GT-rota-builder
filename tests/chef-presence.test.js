import { buildChefPresenceWeek, getChefPresenceSummaryRows } from '../js/chef-presence.js?v=20260720cp';

export function runChefPresenceTests(assert) {
  const state = {
    staff: [
      { id: 'chef-dan', name: 'Dan' },
      { id: 'chef-fred', name: 'Fred' }
    ],
    weeklyInputs: { availability: [] }
  };
  const week = {
    weekIndex: 2,
    weekStart: '2026-07-13',
    inputs: {
      availability: [
        { chef: 'Dan', type: 'Annual Leave', startDate: '2026-07-17', finishDate: '2026-07-17' },
        { chef: 'Dan', type: 'Unavailable', startDate: '2026-07-18', finishDate: '2026-07-18' }
      ]
    },
    rota: [
      { dayName: 'Monday', date: '2026-07-13', assignments: [{ chef: 'Dan', section: 'Garnish' }, { chef: 'Dan', section: 'Breakfast' }] },
      { dayName: 'Tuesday', date: '2026-07-14', assignments: [{ chef: 'Dan', section: 'Float' }, { chef: 'Fred', section: 'Float' }] },
      { dayName: 'Wednesday', date: '2026-07-15', assignments: [{ chef: 'Fred', section: 'Garnish' }] },
      { dayName: 'Thursday', date: '2026-07-16', assignments: [{ chefId: 'chef-dan', chef: 'Renamed visible label', section: 'Sauce' }] },
      { dayName: 'Friday', date: '2026-07-17', assignments: [] },
      { dayName: 'Saturday', date: '2026-07-18', assignments: [] },
      { dayName: 'Sunday', date: '2026-07-19', assignments: [] }
    ]
  };

  const presence = buildChefPresenceWeek({ state, week, chefId: 'chef-dan' });
  assert(presence.gtShifts === 3 && presence.sectionCounts.Breakfast === 1 && presence.sectionCounts.Float === 1, 'Chef Presence: GT shifts, Breakfast and shared Float are counted from assignment data');
  assert(presence.days[1].assignments.length === 1 && presence.days[2].status === 'rest', 'Chef Presence: shared assignments are matched independently by chef identity');
  assert(presence.days[4].status === 'leave' && presence.days[5].status === 'unavailable' && presence.days[6].status === 'rest', 'Chef Presence: leave, unavailability and rest days are classified for the full week');
  assert(presence.days[3].working && presence.sectionCounts.Sauce === 1, 'Chef Presence: stable chef IDs take priority over a visible assignment label');
  const rows = getChefPresenceSummaryRows(presence);
  assert(rows.includes('3 GT shifts') && rows.includes('1 Breakfast') && rows.includes('1 Annual Leave day') && !rows.some((row) => row.startsWith('0 ')), 'Chef Presence: compact summary includes only meaningful values');
}
