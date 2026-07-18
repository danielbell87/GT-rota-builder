import { DISPLAY_SECTIONS } from '../js/constants.js';
import { buildPrintModel, escapePrintHtml, renderPrintDocument } from '../js/print.js';

function makeWeek(weekStart, chefName, mioChef = '') {
  const start = new Date(`${weekStart}T00:00:00`);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(date.getDate() + index);
    const dateValue = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return {
      dayName: date.toLocaleDateString('en-GB', { weekday: 'long' }),
      date: dateValue,
      assignments: DISPLAY_SECTIONS.map((section) => ({ section, chef: `${chefName} ${section}` }))
    };
  });
  return {
    status: 'ok',
    weekStart,
    mioChef,
    inputs: { weekStart, mioChef },
    rota: days,
    hardValidation: []
  };
}

export async function runPrintTests(assert) {
  const unsafeName = '<img src=x onerror="window.printAttack=1">';
  const singleModel = buildPrintModel({ weeks: [makeWeek('2026-07-13', unsafeName, 'Dan & Fred')] });
  assert(singleModel.title === 'GT Rota' && singleModel.weeks[0].dateRange === '13 July 2026 – 19 July 2026', 'Print: single-week model contains the title and full date range');
  assert(JSON.stringify(singleModel.sections) === JSON.stringify(DISPLAY_SECTIONS), 'Print: model contains every required rota section');
  assert(singleModel.weeks[0].days.length === 7 && DISPLAY_SECTIONS.every((section) => singleModel.weeks[0].days.every((day) => day.sections[section].length === 1)), 'Print: model contains the complete seven-day rota table');

  const multiModel = buildPrintModel({
    weeks: [
      makeWeek('2026-07-27', 'Third'),
      makeWeek('2026-07-13', 'First'),
      makeWeek('2026-07-20', 'Hidden second')
    ]
  });
  assert(JSON.stringify(multiModel.weeks.map((week) => week.weekStart)) === JSON.stringify(['2026-07-13', '2026-07-20', '2026-07-27']), 'Print: multi-week model contains every week in chronological order');
  assert(multiModel.weeks.some((week) => week.days[0].sections.Pass[0] === 'Hidden second Pass'), 'Print: model includes weeks independently of the visible results week');

  const html = renderPrintDocument(multiModel);
  assert((html.match(/class="print-week/g) || []).length === 3 && html.includes('break-after: page') && html.includes('page-break-after: always'), 'Print: each week is a separate page-break block');
  assert(html.includes('@page { size: A4 landscape;') && html.includes('thead { display: table-header-group; }'), 'Print: document uses A4 landscape and repeatable table headers');

  const unsafeHtml = renderPrintDocument(singleModel);
  assert(!unsafeHtml.includes(unsafeName) && unsafeHtml.includes('&lt;img src=x onerror=&quot;window.printAttack=1&quot;&gt;'), 'Print: user-editable chef names are safely escaped');
  assert(escapePrintHtml(`A&B <C> "D" 'E'`) === 'A&amp;B &lt;C&gt; &quot;D&quot; &#39;E&#39;', 'Print: HTML escaping covers all markup-significant characters');
}
