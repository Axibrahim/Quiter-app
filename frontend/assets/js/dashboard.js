import { requireAuth, logout } from './modules/auth-state.js';
import { api } from './modules/api-client.js';
import { BloomScene } from './three/bloom-scene.js';

function directionLabel(direction) {
  return direction === 'break' ? 'Break' : 'Build';
}

function renderPlanCard(plan) {
  const pctDone = Math.round((plan.day_number / plan.total_days) * 100);
  const disabled = plan.already_logged_today || plan.is_completed;

  const wrapper = document.createElement('div');
  wrapper.className = 'liquid-glass liquid-glass--panel bento-cell';
  wrapper.style.padding = 'var(--space-4)';
  wrapper.innerHTML = `
    <p class="today-card__day">Day ${plan.day_number} of ${plan.total_days} — ${plan.title} (${directionLabel(plan.direction)})</p>
    <h3 class="today-card__goal">${plan.micro_goal ? escapeHtml(plan.micro_goal) : 'Plan complete 🎉'}</h3>
    ${plan.identity_cue ? `<p class="today-card__cue">${escapeHtml(plan.identity_cue)}</p>` : ''}
    <div style="display:flex; gap: var(--space-3); margin: var(--space-2) 0; font-family: var(--font-mono); font-size:0.85rem; color: var(--ink-40);">
      <span>${plan.current_streak} day streak</span>
      <span>${plan.longest_streak} longest</span>
      <span>${pctDone}% through</span>
    </div>
    <div class="today-card__actions">
      <button class="btn btn--solid" data-checkin="completed" data-plan-id="${plan.user_plan_id}" ${disabled ? 'disabled' : ''} type="button">
        ${plan.already_logged_today ? 'Already checked in today' : 'Mark complete'}
      </button>
      <button class="liquid-glass btn btn--glass" data-checkin="missed" data-plan-id="${plan.user_plan_id}" ${disabled ? 'disabled' : ''} type="button">I slipped today</button>
      <a class="liquid-glass btn btn--glass" href="progress.html?plan=${plan.user_plan_id}">View progress</a>
    </div>
  `;
  return wrapper;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadPlans(bloomScene) {
  const loading = document.getElementById('plans-loading');
  const empty = document.getElementById('plans-empty');
  const list = document.getElementById('plans-list');

  list.innerHTML = '';
  loading.style.display = '';
  empty.style.display = 'none';

  try {
    const plans = await api.get('/plans/mine');
    loading.style.display = 'none';

    const active = plans.filter((p) => !p.is_abandoned);
    if (active.length === 0) {
      empty.style.display = '';
      return;
    }

    active.forEach((plan) => list.appendChild(renderPlanCard(plan)));
  } catch (err) {
    loading.textContent = `Couldn't load your plans (${err.message}).`;
  }
}

/**
 * Delegated click handler for check-in buttons, attached ONCE to the
 * stable #plans-list container rather than re-attached on every reload —
 * event delegation means newly-rendered cards are covered automatically
 * without ever stacking duplicate listeners.
 */
function initCheckinDelegation(bloomScene) {
  const list = document.getElementById('plans-list');
  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-checkin]');
    if (!btn) return;
    const status = btn.dataset.checkin;
    const planId = btn.dataset.planId;
    btn.disabled = true;
    try {
      const result = await api.post(`/plans/${planId}/checkin`, { status });
      if (result.reward_tier > 0 && bloomScene) bloomScene.trigger(result.reward_tier);
      await loadPlans(bloomScene);
    } catch (err) {
      alert(`Couldn't save check-in: ${err.message}`);
      btn.disabled = false;
    }
  });
}


function initBloomScene() {
  const canvas = document.getElementById('bloom-canvas');
  if (!canvas) return null;

  const scene = new BloomScene(canvas);
  scene.start();
  window.addEventListener('pagehide', () => scene.destroy());
  return scene;
}

document.addEventListener('DOMContentLoaded', async () => {
  const user = await requireAuth();
  if (!user) return;

  const bloomScene = initBloomScene();

  initCheckinDelegation(bloomScene);

  await loadPlans(bloomScene);
});