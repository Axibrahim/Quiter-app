import { api, errorText } from './modules/api-client.js';
import { mountCommonFields, PLAN_ERRORS } from './modules/plan-form.js';

const $ = (id) => document.getElementById(id);
const form = $('plan-form'), errorEl = $('form-error'), submit = $('submit');
const common = mountCommonFields($('common'));

let catalog = null;       // { max_tracked, metrics, sports: [...] }
let sport = null;         // selected sport object
const picked = new Set(); // catalog exercise keys
let customExerciseCount = 0;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const customRows = () => [...document.querySelectorAll('.custom-ex')];
const total = () => picked.size + customRows().length;

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

function renderPhases() {
  $('phases').innerHTML = sport.phases.map((p) =>
    `<label class="chip"><input type="radio" name="phase" value="${esc(p.key)}"><span>${esc(p.label)}</span></label>`).join('');
  $('phase-group').hidden = false;
}

function fillSelect(el, map, blank) {
  el.innerHTML = `<option value="">${esc(blank)}</option>` +
    Object.entries(map).map(([k, v]) => `<option value="${esc(k)}">${esc(v)}</option>`).join('');
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

  const inputId = `custom-exercise-${++customExerciseCount}`;
  const metricId = `${inputId}-metric`;

  row.innerHTML = `
    <div class="custom-ex__field">
      <label for="${inputId}">Exercise name</label>
      <input id="${inputId}" type="text" minlength="2" maxlength="60"
        autocomplete="off" placeholder="e.g. Cable fly"
        aria-describedby="custom-exercise-hint" required>
    </div>
    <div class="custom-ex__field custom-ex__field--metric">
      <label for="${metricId}">Track by</label>
      <select id="${metricId}">
        ${Object.entries(catalog.metrics).map(([key, unit]) =>
          `<option value="${esc(key)}">${esc(unit)}</option>`).join('')}
      </select>
    </div>
    <button class="icon-btn custom-ex__remove" type="button" aria-label="Remove custom exercise">Remove</button>`;

  row.querySelector('.custom-ex__remove').addEventListener('click', () => {
    row.remove();
    refreshCount();
  });

  row.querySelector('input').addEventListener('input', (event) => {
    const length = event.target.value.trim().length;
    if (length >= 2 && length <= 60) event.target.removeAttribute('aria-invalid');
    refreshCount();
  });

  $('custom-rows').appendChild(row);
  refreshCount();
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

    const invalidCustom = customRows().find((row) => {
    const input = row.querySelector('input[type="text"]');
    const length = input.value.trim().length;
    const invalid = length < 2 || length > 60;

    if (invalid) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');

    return invalid;
  });

  if (invalidCustom) {
    errorEl.textContent = PLAN_ERRORS.invalid_tracked_exercises;
    invalidCustom.querySelector('input').focus();
    return;
  }

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