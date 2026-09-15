import { requireAuth } from './modules/auth-state.js';
import { api } from './modules/api-client.js';

const STATUS_COLOR = {
  completed: 'var(--accent-teal)',
  partial: '#f8bf40',
  missed: 'rgba(255,255,255,0.15)',
  relapsed: 'var(--accent-ember)',
  none: 'rgba(255,255,255,0.08)',
};

function getPlanIdFromUrl() {
  return new URLSearchParams(window.location.search).get('plan');
}

function renderHeatmap(heatmap) {
  const grid = document.getElementById('progress-heatmap');
  grid.innerHTML = '';
  heatmap.forEach((day) => {
    const cell = document.createElement('div');
    cell.className = 'progress-heatmap__cell';
    cell.style.background = STATUS_COLOR[day.status] || STATUS_COLOR.none;
    cell.title = `${day.date}: ${day.status}`;
    grid.appendChild(cell);
  });
}

async function loadProgress(planId) {
  const loading = document.getElementById('progress-loading');
  const errorEl = document.getElementById('progress-error');
  const content = document.getElementById('progress-content');

  loading.style.display = '';
  errorEl.textContent = '';
  content.style.display = 'none';

  try {
    const data = await api.get(`/plans/${planId}/progress`);
    loading.style.display = 'none';
    content.style.display = '';

    document.getElementById('progress-eyebrow').textContent =
      `${data.direction === 'break' ? 'BREAKING' : 'BUILDING'} · DAY ${data.day_number} OF ${data.total_days}`;
    document.getElementById('progress-title').textContent = data.title;

    document.getElementById('stat-current-streak').textContent = `${data.current_streak} day${data.current_streak === 1 ? '' : 's'}`;
    document.getElementById('stat-longest-streak').textContent = `${data.longest_streak} day${data.longest_streak === 1 ? '' : 's'}`;
    document.getElementById('stat-completion').textContent = `${data.completion_pct}%`;

    const checkinBtn = document.getElementById('progress-checkin-btn');
    if (data.is_completed) {
      checkinBtn.textContent = 'Plan complete 🎉';
      checkinBtn.disabled = true;
    } else if (data.already_logged_today) {
      checkinBtn.textContent = 'Already checked in today';
      checkinBtn.disabled = true;
    } else {
      checkinBtn.textContent = 'Check in today';
      checkinBtn.disabled = false;
    }

    const warning = document.getElementById('progress-warning');
    const warningText = document.getElementById('progress-warning-text');
    if (!data.is_completed && !data.is_abandoned && data.days_since_checkin >= 3) {
      warning.style.display = '';
      warningText.textContent =
        `${data.days_since_checkin} days since your last check-in — plans auto-pause after 15 days of silence. ` +
        `${data.days_until_auto_quit} day${data.days_until_auto_quit === 1 ? '' : 's'} left to keep this one active.`;
    } else {
      warning.style.display = 'none';
    }

    renderHeatmap(data.heatmap);

    checkinBtn.onclick = async () => {
      checkinBtn.disabled = true;
      try {
        await api.post(`/plans/${planId}/checkin`, { status: 'completed' });
        await loadProgress(planId);
      } catch (err) {
        alert(`Couldn't save check-in: ${err.message}`);
        checkinBtn.disabled = false;
      }
    };

    if (!data.is_completed && !data.is_abandoned) {
      initExitConfirm(planId);
    }
  } catch (err) {
    loading.style.display = 'none';
    errorEl.textContent = `Couldn't load this plan's progress (${err.message}).`;
  }
}

document.addEventListener('DOMContentLoaded', async () => {

function initExitConfirm(planId) {
  const btn = document.getElementById('progress-exit-btn');
  if (!btn) return;

  let confirming = false;
  let resetTimer = null;

  const reset = () => {
    confirming = false;
    btn.textContent = 'Exit this plan';
    btn.classList.remove('is-confirming');
    clearTimeout(resetTimer);
  };

  reset();

  btn.onclick = async () => {
    if (!confirming) {
      confirming = true;
      btn.textContent = 'Tap again to confirm exit';
      btn.classList.add('is-confirming');
      resetTimer = setTimeout(reset, 4000); // auto-reverts if they don't confirm
      return;
    }

    btn.disabled = true;
    try {
      await api.post(`/plans/${planId}/abandon`);
      window.location.href = 'dashboard.html';
    } catch (err) {
      alert(`Couldn't exit this plan: ${err.message}`);
      btn.disabled = false;
      reset();
    }
  };
}

  const user = await requireAuth();
  if (!user) return;

  const planId = getPlanIdFromUrl();
  if (!planId) {
    document.getElementById('progress-loading').style.display = 'none';
    document.getElementById('progress-error').textContent = 'No plan selected — go back to your dashboard and pick one.';
    return;
  }

  await loadProgress(planId);
});