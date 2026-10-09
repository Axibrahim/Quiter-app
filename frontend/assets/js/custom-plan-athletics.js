import { api, errorText } from './modules/api-client.js';
import { mountCommonFields, PLAN_ERRORS } from './modules/plan-form.js';

const $ = (id) => document.getElementById(id);
const form = $('plan-form'), errorEl = $('form-error'), submit = $('submit');
const common = mountCommonFields($('common'));

let catalog = null;       // { max_tracked, metrics, experience_levels, diet_styles, sports: [...] }
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
  row.dataset.cid = String(customExerciseCount);
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
  if (sport) { renderPhases(); renderExercises(); }
});
$('exercises').addEventListener('change', (e) => {
  e.target.checked ? picked.add(e.target.value) : picked.delete(e.target.value);
  refreshCount();
});
$('add-custom').addEventListener('click', addCustomRow);
$('goal').addEventListener('input', () => { $('goal-count').textContent = `${$('goal').value.length} / 200`; });


// ---- Daily default numbers (one stepper per chosen exercise) -----------------
const defaults = new Map();   // id -> value as typed; ids: "k:<key>" or "c:<cid>:<metric>"
const defaultSpec = (metric) => catalog?.metric_defaults?.[metric] || { start: 10, step: 1 };

function currentItems() {
  const fromCatalog = sport ? sport.exercises.filter((ex) => picked.has(ex.key)).map((ex) => ({
    id: `k:${ex.key}`, label: ex.label, metric: ex.metric, unit: ex.unit,
  })) : [];
  const fromCustom = customRows().map((row) => {
    const metric = row.querySelector('select').value;
    return { id: `c:${row.dataset.cid}:${metric}`, label: row.querySelector('input').value.trim(), metric, unit: catalog.metrics[metric] };
  }).filter((it) => it.label.length >= 2);
  return [...fromCatalog, ...fromCustom];
}

function renderDefaults() {
  const items = currentItems();
  $('def-group').hidden = !items.length;
  $('def-list').innerHTML = items.map((it) => {
    const spec = defaultSpec(it.metric);
    if (!defaults.has(it.id)) defaults.set(it.id, String(spec.start));
    return `<div class="def-row" data-id="${esc(it.id)}" data-step="${spec.step}">
      <div class="def-row__name"><span>${esc(it.label)}</span><small>${esc(it.unit)}</small></div>
      <div class="stepper">
        <button class="stepper__btn" type="button" data-dir="-1" aria-label="Decrease ${esc(it.label)}">−</button>
        <input type="number" inputmode="decimal" min="0" step="any" value="${esc(defaults.get(it.id))}" aria-label="Daily ${esc(it.label)} in ${esc(it.unit)}">
        <button class="stepper__btn" type="button" data-dir="1" aria-label="Increase ${esc(it.label)}">+</button>
      </div></div>`;
  }).join('');
}

$('def-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.stepper__btn');
  if (!btn) return;
  const row = btn.closest('.def-row'), input = row.querySelector('input');
  const step = Number(row.dataset.step) || 1;
  const next = Math.max(0, Math.round(((Number(input.value) || 0) + step * Number(btn.dataset.dir)) * 100) / 100);
  input.value = String(next);
  defaults.set(row.dataset.id, input.value);
});
$('def-list').addEventListener('input', (e) => {
  const row = e.target.closest('.def-row');
  if (row) defaults.set(row.dataset.id, e.target.value);
});
['sports', 'exercises', 'custom-rows'].forEach((id) => $(id).addEventListener('change', renderDefaults));
$('custom-rows').addEventListener('click', renderDefaults);   // "Remove" buttons


// ---- AI placeholder for "What do you want to reach?" ------------------------
// Re-asks (debounced) whenever an earlier answer changes. Only runs while the box
// is still empty, so it never costs tokens once the user starts typing.
const goalEl = $('goal');
const DEFAULT_GOAL_HINT = goalEl.placeholder;
let hintTimer = null, hintSeq = 0;

const currentPhase = () => document.querySelector('input[name="phase"]:checked')?.value;

function scheduleGoalHint() {
  clearTimeout(hintTimer);
  if (!sport || !currentPhase() || goalEl.value.trim()) return;
  hintTimer = setTimeout(fetchGoalHint, 900);
}

async function fetchGoalHint() {
  const seq = ++hintSeq;
  const tracked = [
    ...[...picked].map((key) => ({ key })),
    ...customRows()
      .map((r) => ({ label: r.querySelector('input').value.trim(), metric: r.querySelector('select').value }))
      .filter((c) => c.label.length >= 2),
  ];
  try {
    const res = await api.post('/plans/goal-placeholder', {
      sport: sport.key,
      phase: currentPhase(),
      experience: $('experience').value || undefined,
      diet: $('diet').value || undefined,
      tracked_exercises: tracked,
    });
    if (seq === hintSeq && res?.placeholder && !goalEl.value.trim()) goalEl.placeholder = res.placeholder;
  } catch { /* keep the current placeholder */ }
}

$('sports').addEventListener('change', () => { goalEl.placeholder = DEFAULT_GOAL_HINT; });
['sports', 'phases', 'exercises', 'custom-rows'].forEach((id) => $(id).addEventListener('change', scheduleGoalHint));
$('custom-rows').addEventListener('click', scheduleGoalHint);   // "Remove" buttons
$('experience').addEventListener('change', scheduleGoalHint);
$('diet').addEventListener('change', scheduleGoalHint);

// ---- Blue's off-day suggestion ------------------------------------------------
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const offHint = $('off-hint');
const OFF_DEFAULT_HINT = offHint.textContent;
let offTimer = null, offSeq = 0;

const offChoice = () => document.querySelector('input[name="offday"]:checked')?.value || 'none';

function scheduleOffHint() {
  clearTimeout(offTimer);
  if (offChoice() !== 'blue') return;
  if (!sport || !currentPhase()) { offHint.textContent = OFF_DEFAULT_HINT; return; }
  offTimer = setTimeout(fetchOffHint, 600);
}

async function fetchOffHint() {
  const seq = ++offSeq;
  const tracked = [
    ...[...picked].map((key) => ({ key })),
    ...customRows()
      .map((r) => ({ label: r.querySelector('input').value.trim(), metric: r.querySelector('select').value }))
      .filter((c) => c.label.length >= 2),
  ];
  try {
    const res = await api.post('/plans/off-day-suggestion', { sport: sport.key, phase: currentPhase(), tracked_exercises: tracked });
    if (seq === offSeq && offChoice() === 'blue') offHint.textContent = `Blue suggests ${WEEKDAYS[res.weekday]}s. ${res.reason}`;
  } catch { offHint.textContent = 'Blue will pick a day when your plan is created.'; }
}

document.querySelectorAll('input[name="offday"]').forEach((r) => r.addEventListener('change', scheduleOffHint));
['sports', 'phases', 'exercises', 'custom-rows'].forEach((id) => $(id).addEventListener('change', scheduleOffHint));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  if (!sport) { errorEl.textContent = PLAN_ERRORS.invalid_sport; return; }

  const phase = document.querySelector('input[name="phase"]:checked')?.value;
  if (!phase) { errorEl.textContent = 'Pick your current phase.'; return; }

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
    ...[...picked].map((key) => ({ key, default: Number(defaults.get(`k:${key}`)) })),
    ...customRows()
      .map((r) => {
        const metric = r.querySelector('select').value;
        return { label: r.querySelector('input').value.trim(), metric, default: Number(defaults.get(`c:${r.dataset.cid}:${metric}`)) };
      })
      .filter((c) => c.label),
  ];
  if (!tracked.length) { errorEl.textContent = PLAN_ERRORS.invalid_tracked_exercises; return; }
  if (tracked.some((t) => !(t.default > 0))) {
    errorEl.textContent = PLAN_ERRORS.invalid_default_numbers;
    $('def-group').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const goal = $('goal').value.trim();
  if (goal.length < 3) { errorEl.textContent = PLAN_ERRORS.invalid_progression_goal; $('goal').focus(); return; }

  submit.disabled = true;
  submit.textContent = 'Creating…';
  try {
    await api.post('/plans/custom-athletic', {
      sport: sport.key,
      progression_goal: goal,
      tracked_exercises: tracked,
      phase,
      experience: $('experience').value || undefined,
      diet: $('diet').value || undefined,
      ...common.read(), off_day: offChoice(),
    });
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
    fillSelect($('experience'), catalog.experience_levels, 'Not sure');
    fillSelect($('diet'), catalog.diet_styles, 'No preference');
  } catch (ex) {
    $('sports').innerHTML = `<span class="error">${esc(errorText(ex.message))}</span>`;
  }
})();