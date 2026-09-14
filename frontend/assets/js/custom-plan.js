import { requireAuth } from './modules/auth-state.js';
import { api } from './modules/api-client.js';

function initCustomPlanForm() {
  const form = document.getElementById('custom-plan-form');
  const errorEl = document.getElementById('custom-error');
  const goalInput = document.getElementById('custom-goal');
  const goalCount = document.getElementById('custom-goal-count');
  const lengthInput = document.getElementById('custom-length');
  const lengthOutput = document.getElementById('custom-length-output');
  const identityInput = document.getElementById('custom-identity');

  if (!form) return;

  const updateGoalCount = () => {
    if (goalCount && goalInput) {
      goalCount.textContent = `${goalInput.value.length} / 160`;
    }
  };

  const updateLength = (value) => {
    const days = Math.min(365, Math.max(3, Number(value)));
    lengthInput.value = days;
    lengthOutput.textContent = `${days} day${days === 1 ? '' : 's'}`;

    const progress = ((days - 3) / (365 - 3)) * 100;
    lengthInput.style.setProperty('--range-progress', `${progress}%`);

    document.querySelectorAll('[data-plan-preset]').forEach((button) => {
      button.classList.toggle('is-active', Number(button.dataset.planPreset) === days);
    });
  };

  const updateReminderRows = () => {
    document.querySelectorAll('[data-reminder-row]').forEach((row) => {
      const toggle = row.querySelector('[data-reminder-toggle]');
      const timeInput = row.querySelector('[data-reminder-time]');
      if (!toggle || !timeInput) return;
      timeInput.disabled = !toggle.checked;
      row.classList.toggle('is-selected', toggle.checked);
    });
  };

  updateGoalCount();
  updateLength(lengthInput.value);
  updateReminderRows();

  goalInput?.addEventListener('input', updateGoalCount);
  lengthInput?.addEventListener('input', () => updateLength(lengthInput.value));

  document.querySelectorAll('[data-plan-preset]').forEach((button) => {
    button.addEventListener('click', () => updateLength(button.dataset.planPreset));
  });

  document.querySelectorAll('[data-reminder-row]').forEach((row) => {
    row.addEventListener('change', updateReminderRows);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.textContent = '';

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const reminderTimes = [...document.querySelectorAll('[data-reminder-row]')]
      .filter((row) => row.querySelector('[data-reminder-toggle]')?.checked)
      .map((row) => row.querySelector('[data-reminder-time]')?.value)
      .filter(Boolean);

    let reminderTimezone = 'UTC';
    try {
      reminderTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      reminderTimezone = 'UTC';
    }

    try {
      await api.post('/plans/custom', {
        goal_text: goalInput.value.trim(),
        direction: form.querySelector('input[name="custom-direction"]:checked').value,
        length_days: Number(lengthInput.value),
        identity_statement: identityInput.value.trim(),
        support_style: form.querySelector('input[name="custom-support-style"]:checked').value,
        reminder_times: reminderTimes,
        reminder_timezone: reminderTimezone,
      });

      window.location.href = 'dashboard.html';
    } catch (err) {
      const messages = {
        invalid_goal_text: 'Describe your goal in 3–160 characters.',
        invalid_length_days: 'Choose a plan period between 3 and 365 days.',
        invalid_identity_statement: 'Your identity statement must be 160 characters or fewer.',
        invalid_support_style: 'Choose one of the available support styles.',
        invalid_reminder_times: 'Choose up to three valid reminder times.',
        invalid_timezone: 'We could not read your timezone. Please try again.',
        max_plans_reached: "You've reached the limit of 3 active plans at once. Finish or drop one first.",
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

  initCustomPlanForm();
});