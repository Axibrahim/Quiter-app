import { api, errorText } from './modules/api-client.js';
import { mountCommonFields, PLAN_ERRORS } from './modules/plan-form.js';

const $ = (id) => document.getElementById(id);
const form = $('plan-form'), errorEl = $('form-error'), submit = $('submit');
const common = mountCommonFields($('common'));

let catalog = null;       // { max_tracked, metrics, sports: [...] }
let sport = null;         // selected sport object
const picked = new Set(); // catalog exercise keys

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const customRows = () => [...document.querySelectorAll('.custom-ex')];
const total = () => picked.size + customRows().filter((r) => r.querySelector('input[type=text]').value.trim()).length;

function refreshCount() {
  $('ex-count').textContent = `${total()} / ${catalog.max_tracked}`;
  const full = total() >= catalog.max_tracked;
  document.querySelectorAll('#exercises input').forEach((i) => { i.disabled = full && !i.checked; });
  $('add-custom').disabled = full;
}

function renderSports() {
  $('sports').innerHTML = catalog.sports.map((s) =>
    `<label class="chip"><input type="radio" name="sport" value="${esc(s.key)}"><span>${esc(s.label)}</span></label>`).join('');
}

function renderExercises() {
  picked.clear();
  $('exercises').innerHTML = sport.exercises.map((ex) =>
    `<label class="chip"><input type="checkbox" value="${esc(ex.key)}"><span>${esc(ex.label)} · ${esc(ex.unit)}</span></label>`).join('');
  $('custom-rows').innerHTML = '';
  $('ex-group').hidden = false;
  refreshCount();
}

function addCustomRow() {
  if (total() >= catalog.max_tracked) return;
  const row = document.createElement('div');
  row.className = 'custom-ex';
  row.innerHTML = `
    <input type="text" maxlength="60" placeholder="Exercise name" aria-label="Custom exercise name">
    <select aria-label="Metric">${Object.entries(catalog.metrics).map(([k, u]) => `<option value="${k}">${esc(u)}</option>`).join('')}</select>
    <button class="icon-btn" type="button" aria-label="Remove">✕</button>`;
  row.querySelector('button').addEventListener('click', () => { row.remove(); refreshCount(); });
  row.querySelector('input').addEventListener('input', refreshCount);
  $('custom-rows').appendChild(row);
  row.querySelector('input').focus();
}

$('sports').addEventListener('change', (e) => {
  sport = catalog.sports.find((s) => s.key === e.target.value);
  if (sport) renderExercises();
});
$('exercises').addEventListener('change', (e) => {
  e.target.checked ? picked.add(e.target.value) : picked.delete(e.target.value);
  refreshCount();
});
$('add-custom').addEventListener('click', addCustomRow);
$('goal').addEventListener('input', () => { $('goal-count').textContent = `${$('goal').value.length} / 200`; });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  if (!sport) { errorEl.textContent = PLAN_ERRORS.invalid_sport; return; }

  const tracked = [
    ...[...picked].map((key) => ({ key })),
    ...customRows()
      .map((r) => ({ label: r.querySelector('input').value.trim(), metric: r.querySelector('select').value }))
      .filter((c) => c.label),
  ];
  if (!tracked.length) { errorEl.textContent = PLAN_ERRORS.invalid_tracked_exercises; return; }
  const goal = $('goal').value.trim();
  if (goal.length < 3) { errorEl.textContent = PLAN_ERRORS.invalid_progression_goal; $('goal').focus(); return; }

  submit.disabled = true;
  submit.textContent = 'Creating…';
  try {
    await api.post('/plans/custom-athletic', { sport: sport.key, progression_goal: goal, tracked_exercises: tracked, ...common.read() });
    window.location.href = 'dashboard.html';
  } catch (ex) {
    errorEl.textContent = PLAN_ERRORS[ex.message] || errorText(ex.message);
    submit.disabled = false;
    submit.textContent = 'Create my athlete plan';
  }
});

(async function load() {
  try {
    catalog = await api.get('/plans/exercise-catalog');
    renderSports();
  } catch (ex) {
    $('sports').innerHTML = `<span class="error">${esc(errorText(ex.message))}</span>`;
  }
})();