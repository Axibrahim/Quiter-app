import { requireAuth } from './modules/auth-state.js';
import { api } from './modules/api-client.js';

let selectedExercise = null;

function labelize(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function renderExerciseLibrary() {
  const wrap = document.getElementById('exercise-library');
  try {
    const library = await api.get('/plans/exercise-library');
    wrap.innerHTML = '';
    library.forEach((item) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'liquid-glass exercise-chip';
      chip.textContent = labelize(item);
      chip.dataset.exercise = item;
      chip.addEventListener('click', () => {
        selectedExercise = item;
        wrap.querySelectorAll('.exercise-chip').forEach((c) => c.classList.remove('is-active'));
        chip.classList.add('is-active');
      });
      wrap.appendChild(chip);
    });
  } catch (err) {
    wrap.textContent = "Couldn't load the exercise library.";
  }
}

function addExerciseRow() {
  const container = document.getElementById('custom-exercise-rows');
  if (container.children.length >= 4) return;

  const row = document.createElement('div');
  row.className = 'modal__field';
  row.style.display = 'flex';
  row.style.gap = '0.5rem';
  row.innerHTML = `
    <input type="text" maxlength="60" placeholder="e.g. Bulgarian split squats" data-custom-exercise style="flex: 1;" />
    <button type="button" class="liquid-glass btn btn--glass" data-remove-exercise>Remove</button>
  `;
  row.querySelector('[data-remove-exercise]').addEventListener('click', () => row.remove());
  container.appendChild(row);
}

function initForm() {
  const form = document.getElementById('athletic-form');
  const errorEl = document.getElementById('athletic-error');
  const goalInput = document.getElementById('athletic-goal');
  const goalCount = document.getElementById('athletic-goal-count');
  const lengthInput = document.getElementById('athletic-length');
  const lengthOutput = document.getElementById('athletic-length-output');
  const identityInput = document.getElementById('athletic-identity');

  const updateGoalCount = () => {
    goalCount.textContent = `${goalInput.value.length} / 200`;
  };

  const updateLength = (value) => {
    const days = Math.min(365, Math.max(3, Number(value)));
    lengthInput.value = days;
    lengthOutput.textContent = `${days} day${days === 1 ? '' : 's'}`;
    document.querySelectorAll('[data-plan-preset]').forEach((button) => {
      button.classList.toggle('is-active', Number(button.dataset.planPreset) === days);
    });
  };

  const updateReminderRows = () => {
    document.querySelectorAll('[data-reminder-row]').forEach((row) => {
      const toggle = row.querySelector('[data-reminder-toggle]');
      const timeInput = row.querySelector('[data-reminder-time]');
      timeInput.disabled = !toggle.checked;
      row.classList.toggle('is-selected', toggle.checked);
    });
  };

  updateGoalCount();
  updateLength(lengthInput.value);
  updateReminderRows();

  goalInput.addEventListener('input', updateGoalCount);
  lengthInput.addEventListener('input', () => updateLength(lengthInput.value));
  document.querySelectorAll('[data-plan-preset]').forEach((button) => {
    button.addEventListener('click', () => updateLength(button.dataset.planPreset));
  });
  document.querySelectorAll('[data-reminder-row]').forEach((row) => {
    row.addEventListener('change', updateReminderRows);
  });

  document.getElementById('add-exercise-btn').addEventListener('click', addExerciseRow);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';

    if (!selectedExercise) {
      errorEl.textContent = 'Pick a discipline from the list above.';
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const customExercises = [...document.querySelectorAll('[data-custom-exercise]')]
      .map((input) => input.value.trim())
      .filter(Boolean);

    const reminderTimes = [...document.querySelectorAll('[data-reminder-row]')]
      .filter((row) => row.querySelector('[data-reminder-toggle]').checked)
      .map((row) => row.querySelector('[data-reminder-time]').value)
      .filter(Boolean);

    let reminderTimezone = 'UTC';
    try {
      reminderTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      reminderTimezone = 'UTC';
    }

    try {
      await api.post('/plans/custom-athletic', {
        exercise_type: selectedExercise,
        progression_goal: goalInput.value.trim(),
        custom_exercises: customExercises,
        length_days: Number(lengthInput.value),
        identity_statement: identityInput.value.trim(),
        support_style: form.querySelector('input[name="athletic-support-style"]:checked').value,
        reminder_times: reminderTimes,
        reminder_timezone: reminderTimezone,
      });

      window.location.href = 'dashboard.html';
    } catch (err) {
      const messages = {
        invalid_exercise_type: 'Pick a discipline from the list.',
        invalid_progression_goal: 'Describe your goal in 3–200 characters.',
        invalid_custom_exercises: 'Custom exercises must be 60 characters or fewer, up to 4 total.',
        invalid_length_days: 'Choose a plan period between 3 and 365 days.',
        max_plans_reached: "You've reached the limit of 3 active plans at once.",
      };
      errorEl.textContent = messages[err.message] || "Couldn't create that plan — please try again.";
    } finally {
      submitBtn.disabled = false;
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuth();
  if (!user) return;

  await renderExerciseLibrary();
  initForm();
});