import { api, errorText } from './modules/api-client.js';
import { mountCommonFields, PLAN_ERRORS } from './modules/plan-form.js';

const form = document.getElementById('plan-form');
const goal = document.getElementById('goal');
const count = document.getElementById('goal-count');
const errorEl = document.getElementById('form-error');
const submit = document.getElementById('submit');
const common = mountCommonFields(document.getElementById('common'));

goal.addEventListener('input', () => { count.textContent = `${goal.value.length} / 120`; });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  const goalText = goal.value.trim();
  if (goalText.length < 3) { errorEl.textContent = PLAN_ERRORS.invalid_goal_text; goal.focus(); return; }

  submit.disabled = true;
  submit.textContent = 'Creating…';
  try {
    await api.post('/plans/custom', { goal_text: goalText, ...common.read() });
    window.location.href = 'dashboard.html';
  } catch (ex) {
    errorEl.textContent = PLAN_ERRORS[ex.message] || errorText(ex.message);
    submit.disabled = false;
    submit.textContent = 'Create my plan';
  }
});