const REQUIRED_DOM_IDS = [
  'weekStart',
  'mioChef',
  'numWeeks',
  'singleWeekMioControl',
  'weeklyMioPlan',
  'additionalChefList',
  'addAdditionalChefBtn',
  'availabilityBody',
  'addAvailabilityBtn',
  'staffBody',
  'addChefBtn',
  'results',
  'chefModal',
  'cancelChefBtn',
  'saveChefBtn',
  'additionalChefModal',
  'additionalChefWeekRange',
  'additionalChefDate',
  'additionalChefCount',
  'cancelAdditionalChefBtn',
  'saveAdditionalChefBtn'
];

async function loadPageInIframe(src) {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = src;
    iframe.onload = () => resolve(iframe);
    document.body.appendChild(iframe);
  });
}

export async function runUiTests(assert) {
  const [indexHtml, legacyHtml] = await Promise.all([
    fetch('../index.html').then((response) => response.text()),
    fetch('../GT%20Rota%20builder.html').then((response) => response.text())
  ]);
  const parser = new DOMParser();
  const indexDoc = parser.parseFromString(indexHtml, 'text/html');
  const legacyDoc = parser.parseFromString(legacyHtml, 'text/html');

  const missingIds = REQUIRED_DOM_IDS.filter((id) => !indexDoc.getElementById(id) || !legacyDoc.getElementById(id));
  assert(missingIds.length === 0, 'Both HTML entry pages contain identical required DOM elements', missingIds.join(', '));

  const [indexFrame, legacyFrame] = await Promise.all([
    loadPageInIframe('../index.html'),
    loadPageInIframe('../GT%20Rota%20builder.html')
  ]);

  assert(indexFrame.contentWindow.__gtRotaBootstrap?.ok === true, 'index.html initialises without errors');
  assert(legacyFrame.contentWindow.__gtRotaBootstrap?.ok === true, 'GT Rota builder.html initialises without errors');

  indexFrame.remove();
  legacyFrame.remove();
}
