import { DISPLAY_SECTIONS } from './constants.js';
import { formatDate, parseLocalDate } from './utils.js';
import { composeDateNotes } from './rota-notes.js?v=20260720notes';

const PRINT_ASSET_BASE = new URL('../', import.meta.url).href;

export function escapePrintHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function getWeekEnd(weekStart) {
  const end = parseLocalDate(weekStart);
  end.setDate(end.getDate() + 6);
  return end.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatFullDate(dateValue) {
  return parseLocalDate(dateValue).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getAssignmentNames(day, section) {
  return (day.assignments || [])
    .filter((assignment) => assignment.section === section)
    .map((assignment) => String(assignment.chef));
}

export function buildPrintModel(overallResult) {
  const weeks = (overallResult?.weeks || [])
    .filter((week) => Array.isArray(week?.rota) && week.rota.length > 0)
    .slice()
    .sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)))
    .map((week, index) => ({
      weekNumber: index + 1,
      weekStart: week.weekStart,
      dateRange: `${formatFullDate(week.weekStart)} – ${getWeekEnd(week.weekStart)}`,
      mioChef: week.inputs?.mioChef || week.mioChef || '',
      days: week.rota.map((day) => ({
        dayName: day.dayName,
        date: day.date,
        notes: composeDateNotes(day.date, week.inputs || {}),
        issues: (week.hardValidation || []).filter((issue) => issue.passed === false && issue.scope === 'day' && issue.date === day.date).map((issue) => issue.message),
        sections: Object.fromEntries(DISPLAY_SECTIONS.map((section) => [
          section,
          getAssignmentNames(day, section)
        ])),
        cellIssues: Object.fromEntries(DISPLAY_SECTIONS.map((section) => [
          section,
          (week.hardValidation || []).filter((issue) => (
            issue.passed === false
            && (
              (issue.affectedCells || []).some((cell) => cell.date === day.date && cell.section === section)
              || (issue.scope !== 'day' && issue.scope !== 'week' && issue.date === day.date && issue.section === section)
            )
          )).map((issue) => issue.message)
        ]))
      })),
      warnings: [...new Set((week.hardValidation || [])
        .filter((result) => result.passed === false)
        .map((result) => `${result.ruleId ? `Rule ${result.ruleId}: ` : ''}${result.message}`))],
      decisions: (week.diagnostics || [])
        .filter((item) => item.type === 'warning' || item.type === 'compromise')
        .slice(0, 5)
        .map((item) => item.message)
    }));

  return {
    title: 'GT Rota',
    sections: [...DISPLAY_SECTIONS],
    weeks
  };
}

function renderPrintWeek(week, sections, isLast) {
  const dayHeaders = week.days.map((day) => `
    <th scope="col" class="${day.issues.length ? 'print-day-error' : ''}">${day.issues.length ? '<strong class="print-error-icon" aria-hidden="true">!</strong>' : ''}${escapePrintHtml(day.dayName)}<span>${escapePrintHtml(formatDate(day.date))}</span></th>`).join('');
  const rows = sections.map((section) => `
    <tr>
      <th scope="row">${escapePrintHtml(section)}</th>
      ${week.days.map((day) => {
        const names = day.sections[section] || [];
        const issues = day.cellIssues?.[section] || [];
        const errorLabel = issues.length ? ` title="${escapePrintHtml(issues.join(' '))}" aria-label="Error: ${escapePrintHtml(issues.join(' '))}"` : '';
        return `<td class="${issues.length ? 'print-cell-error' : ''}"${errorLabel}>${issues.length ? '<strong class="print-error-icon" aria-hidden="true">!</strong>' : ''}${names.length ? names.map(escapePrintHtml).join('<br>') : ''}</td>`;
      }).join('')}
    </tr>`).join('');
  const notesRow = `<tr class="print-notes-row"><th scope="row">Notes</th>${week.days.map((day) => `<td>${(day.notes || []).map((line) => `<span>${escapePrintHtml(line.text)}</span>`).join('')}</td>`).join('')}</tr>`;
  const warnings = week.warnings.length
    ? `<aside class="warnings"><strong>Warnings</strong><ul>${week.warnings.map((warning) => `<li>${escapePrintHtml(warning)}</li>`).join('')}</ul></aside>`
    : '';
  const decisions = week.decisions.length
    ? `<aside class="decisions"><strong>Important rota decisions</strong><ul>${week.decisions.map((message) => `<li>${escapePrintHtml(message)}</li>`).join('')}</ul></aside>`
    : '';

  return `
    <section class="print-week${isLast ? ' print-week-last' : ''}">
      <header class="print-masthead">
        <img class="print-feather" src="assets/tarleton-feather.svg" alt="" aria-hidden="true">
        <div class="print-brand">
          <img class="print-wordmark" src="assets/general-tarleton-logo.svg" alt="The General Tarleton">
          <span class="print-divider" aria-hidden="true"></span>
          <div class="print-product">
            <span>Kitchen planning</span>
            <strong>Rota Builder</strong>
          </div>
        </div>
        <div class="week-details">
          <span class="week-number">Week ${week.weekNumber}</span>
          <strong>${escapePrintHtml(week.dateRange)}</strong>
          ${week.mioChef ? `<span>MIO chef: ${escapePrintHtml(week.mioChef)}</span>` : ''}
        </div>
      </header>
      ${week.warnings.length ? '<p class="draft-print-warning"><strong>Contains unresolved rule issues</strong></p>' : ''}
      <table>
        <thead><tr><th scope="col">Section</th>${dayHeaders}</tr></thead>
        <tbody>${rows}${notesRow}</tbody>
      </table>
      ${warnings}
      ${decisions}
      <footer class="print-footer"><span>The General Tarleton · Kitchen rota</span><span>Week ${week.weekNumber}</span></footer>
    </section>`;
}

export function renderPrintDocument(model) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base href="${escapePrintHtml(PRINT_ASSET_BASE)}">
  <title>${escapePrintHtml(model.title)}</title>
  <style>
    @page { size: A4 landscape; margin: 10mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #ebeae6; color: #252525; font-family: Arial, Helvetica, sans-serif; }
    .print-week { width: min(100%, 277mm); min-height: 190mm; margin: 12px auto; padding: 10mm; background: #fffefa; break-after: page; page-break-after: always; }
    .print-week-last { break-after: auto; page-break-after: auto; }
    .print-masthead { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 10mm; min-height: 24mm; margin-bottom: 4mm; padding: 4mm 5mm; overflow: hidden; color: #fff; background: #2f2f2f; break-after: avoid; page-break-after: avoid; }
    .print-feather { position: absolute; z-index: 0; right: 19mm; top: -22mm; width: 47mm; height: auto; opacity: .11; transform: rotate(35deg); }
    .print-brand, .week-details { position: relative; z-index: 1; }
    .print-brand { display: flex; align-items: center; gap: 4mm; min-width: 0; }
    .print-wordmark { width: 42mm; height: auto; filter: invert(1) grayscale(1) brightness(3); }
    .print-divider { align-self: stretch; width: .3mm; min-height: 14mm; background: rgba(255,255,255,.3); }
    .print-product { display: grid; gap: .8mm; text-transform: uppercase; }
    .print-product span { color: #d9d9d6; font-size: 5.5pt; font-weight: 700; letter-spacing: .16em; }
    .print-product strong { font-family: Georgia, "Times New Roman", serif; font-size: 16pt; font-weight: 400; letter-spacing: .015em; line-height: .92; }
    .week-details { display: grid; gap: 1mm; max-width: 72mm; text-align: right; font-size: 8.5pt; }
    .week-number { color: #d9d9d6; font-size: 6pt; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    .week-details strong { font-size: 10pt; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.5pt; break-inside: avoid; page-break-inside: avoid; }
    thead { display: table-header-group; }
    tr { break-inside: avoid; page-break-inside: avoid; }
    th, td { border: 0.35mm solid #555; padding: 2.2mm 1.8mm; vertical-align: top; overflow-wrap: anywhere; }
    thead th { background: #2f2f2f; color: #fff; text-align: center; }
    thead th:first-child, tbody th { width: 25mm; }
    thead span { display: block; margin-top: 1mm; font-size: 7.5pt; font-weight: normal; }
    tbody th { background: #e9e8e4; text-align: left; }
    tbody tr:nth-child(even) td { background: #f6f5f1; }
    td { line-height: 1.25; font-weight: 600; }
    .print-cell-error { border: 0.8mm double #7f1d1d; background: #fff !important; }
    .print-day-error { outline:0.8mm double #fff; outline-offset:-1.2mm; background:#7f1d1d !important; }
    .print-error-icon { display: inline-grid; place-items: center; width: 4.5mm; height: 4.5mm; margin-right: 1.5mm; border: 0.5mm solid #111; border-radius: 50%; font-size: 8pt; line-height: 1; }
    .print-notes-row { break-inside: avoid; page-break-inside: avoid; }
    .print-notes-row th, .print-notes-row td { height: auto; min-height: 9mm; padding: 1.5mm; color: #555; font-size: 6.7pt; line-height: 1.25; vertical-align: top; }
    .print-notes-row td span { display: block; white-space: pre-wrap; }
    .print-notes-row td span + span { margin-top: 0.8mm; }
    .warnings { margin-top: 4mm; padding: 3mm; border: 0.35mm solid #92400e; background: #fffbeb; font-size: 8pt; break-inside: avoid; page-break-inside: avoid; }
    .draft-print-warning { margin:0 0 3mm; padding:2mm 3mm; border:0.5mm solid #7f1d1d; background:#fff1f2; font-size:9pt; }
    .warnings ul { margin: 1.5mm 0 0; padding-left: 5mm; }
    .decisions { margin-top: 4mm; padding: 3mm; border: 0.35mm solid #777; background: #f6f5f1; font-size: 8pt; break-inside: avoid; page-break-inside: avoid; }
    .decisions ul { margin: 1.5mm 0 0; padding-left: 5mm; }
    .print-footer { display: flex; justify-content: space-between; margin-top: 4mm; padding-top: 2mm; border-top: .3mm solid #bdbbb5; color: #777; font-size: 6pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; break-inside: avoid; page-break-inside: avoid; }
    @media print {
      body { background: #fff; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .print-week { width: auto; min-height: 0; margin: 0; padding: 0; background: #fff; box-shadow: none; }
    }
    @media screen and (max-width: 760px) {
      body { overflow-x: auto; }
      .print-week { width: 277mm; margin: 0; }
    }
  </style>
</head>
<body>
  ${model.weeks.map((week, index) => renderPrintWeek(week, model.sections, index === model.weeks.length - 1)).join('')}
</body>
</html>`;
}

export function openPrintWindow(overallResult, hostWindow = window) {
  const printWindow = hostWindow.open('', '_blank');
  if (!printWindow) return false;

  const model = buildPrintModel(overallResult);
  printWindow.addEventListener('load', () => {
    printWindow.setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 100);
  }, { once: true });
  printWindow.document.open();
  printWindow.document.write(renderPrintDocument(model));
  printWindow.document.close();
  return true;
}
