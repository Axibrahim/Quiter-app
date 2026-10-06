/**
 * Dashboard: one glass card per plan.
 *  - the circle checkbox marks today complete (athletes: saves their numbers too)
 *  - the coach message loads per plan (AI when configured, templates otherwise)
 *  - "I missed today" needs a second tap to confirm (it resets the streak)
 */
import { api, errorText } from './modules/api-client.js';

const MAX_PLANS = 3;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const listEl = document.getElementById('plans');
const errEl = document.getElementById('dash-error');
let plans = [];

// Athlete goals are stored as "Sport — target"; the sport already shows as a badge.
const cleanGoal = (p) => (p.sport_label && p.goal_text.startsWith(`${p.sport_label} — `) ? p.goal_text.slice(p.sport_label.length + 3) : p.goal_text);

function exerciseInputs(p) {
  if (p.plan_type !== 'athletic' || !p.tracked_exercises.length) return '';
  const locked = p.already_logged_today || p.is_completed;
  return `<div class="ex-grid">${p.tracked_exercises.map((ex) => {
    const v = p.today_values?.[ex.key];
    return `<div class="ex-input"><label for="ex-${esc(p.user_plan_id)}-${esc(ex.key)}">${esc(ex.label)}</label>
      <div><input id="ex-${esc(p.user_plan_id)}-${esc(ex.key)}" data-key="${esc(ex.key)}" type="number" inputmode="decimal" min="0" step="any" placeholder="0" value="${v ?? ''}" ${locked ? 'disabled' : ''}><span>${esc(ex.unit)}</span></div></div>`;
  }).join('')}</div>`;
}

function cardHtml(p) {
  const pct = Math.min(100, Math.round((p.day_number / p.total_days) * 100));
  const athlete = p.plan_type === 'athletic';
  const done = p.already_logged_today || p.is_completed;
  const coach = p.is_completed ? '' : `
    <div class="coach ${p.coach_message ? '' : 'is-loading'}" data-coach>
      <p class="coach__label">Your coach</p><p class="coach__text">${esc(p.coach_message || 'Writing today’s message…')}</p></div>`;

  const checkLabel = p.is_completed ? 'Plan complete' : done ? 'Marked as on track' : "Yes, I'm on track today";
  const video = p.video_checkin_frequency && !p.is_completed
    ? `<a class="btn btn--text btn--sm" href="progress.html?plan=${esc(p.user_plan_id)}#video">Video check-in</a>` : '';

  return `
  <article class="plan liquid-glass liquid-glass--panel ${done ? 'is-done' : ''}" data-id="${esc(p.user_plan_id)}">
    <div class="plan__top"><span class="badge ${athlete ? 'badge--athlete' : ''}">${athlete ? esc(p.sport_label || 'Athlete') : 'Personal'}</span>
      <span class="plan__day">Day ${p.day_number} of ${p.total_days}</span></div>
    <h2 class="plan__title">${esc(cleanGoal(p))}</h2>
    <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    <div class="plan__stats"><span>Streak <b>${p.current_streak}</b></span><span>Best <b>${p.longest_streak}</b></span></div>
    ${coach}
    ${!p.is_completed && p.micro_goal ? `<p class="today__goal">${esc(p.micro_goal)}</p>` : ''}
    ${!p.is_completed && p.identity_cue ? `<p class="today__cue">${esc(p.identity_cue)}</p>` : ''}
    ${exerciseInputs(p)}
    <p class="error" data-error role="alert"></p>
    <div class="plan__actions">
      <label class="q-check q-check--lg"><input type="checkbox" data-done ${done ? 'checked disabled' : ''}><span class="q-check__box"></span><span class="q-check__label">${checkLabel}</span></label>
      <div class="plan__links">
        ${athlete && !done ? '<button class="btn btn--glass liquid-glass btn--sm" type="button" data-save>Save numbers</button>' : ''}
        ${!done ? '<button class="btn btn--text btn--sm" type="button" data-miss>I missed today</button>' : ''}
        ${video}
        <a class="btn btn--text btn--sm" href="progress.html?plan=${esc(p.user_plan_id)}">Progress</a>
      </div>
    </div>
  </article>`;
}

function render() {
  const active = plans.filter((p) => !p.is_abandoned && !p.is_completed).length;
  document.getElementById('new-plan').hidden = active >= MAX_PLANS;
  if (!plans.length) {
    listEl.innerHTML = `<div class="empty liquid-glass liquid-glass--panel"><h2 class="h3">No plan yet</h2>
      <p>Pick athlete or personal coaching and your coach will take it from there.</p>
      <a class="btn btn--solid" href="plans.html">Build my first plan</a></div>`;
    return;
  }
  listEl.innerHTML = plans.map(cardHtml).join('');
}

function replaceCard(p) {
  const old = listEl.querySelector(`[data-id="${CSS.escape(p.user_plan_id)}"]`);
  if (old) old.outerHTML = cardHtml(p);
}

function readEntries(card) {
  return [...card.querySelectorAll('.ex-input input')]
    .filter((i) => i.value !== '' && Number(i.value) >= 0)
    .map((i) => ({ exercise_key: i.dataset.key, value: Number(i.value) }));
}

async function loadCoachMessages() {
  await Promise.all(plans.filter((p) => !p.coach_message && !p.is_completed && !p.is_abandoned).map(async (p) => {
    try {
      const { message } = await api.get(`/plans/${p.user_plan_id}/coach-message`);
      if (message) p.coach_message = message;
    } catch { /* keep the placeholder text out: fall back to nothing */ }
    const box = listEl.querySelector(`[data-id="${CSS.escape(p.user_plan_id)}"] [data-coach]`);
    if (!box) return;
    if (p.coach_message) { box.classList.remove('is-loading'); box.querySelector('.coach__text').textContent = p.coach_message; }
    else box.remove();
  }));
}

async function complete(card, p) {
  const entries = p.plan_type === 'athletic' ? readEntries(card) : [];
  let result;
  if (entries.length) {
    ({ checkin: result } = await api.post(`/plans/${p.user_plan_id}/exercise-log`, { entries, checkin: true }));
    entries.forEach((e) => { p.today_values[e.exercise_key] = e.value; });
  } else {
    result = await api.post(`/plans/${p.user_plan_id}/checkin`, { status: 'completed' });
  }
  p.already_logged_today = true;
  if (result) { p.current_streak = result.current_streak; p.longest_streak = Math.max(p.longest_streak, result.longest_streak ?? result.current_streak); p.is_completed = !!result.is_completed; }
}

listEl.addEventListener('change', async (e) => {
  const box = e.target.closest('[data-done]');
  if (!box || !box.checked) return;
  const card = box.closest('.plan');
  const p = plans.find((x) => x.user_plan_id === card.dataset.id);
  const err = card.querySelector('[data-error]');
  err.textContent = '';
  box.disabled = true;
  try {
    await complete(card, p);
    replaceCard(p);
  } catch (ex) {
    box.checked = false; box.disabled = false;
    if (ex.message === 'already_logged_today') { p.already_logged_today = true; replaceCard(p); return; }
    err.textContent = errorText(ex.message);
  }
});

listEl.addEventListener('click', async (e) => {
  const card = e.target.closest('.plan');
  if (!card) return;
  const p = plans.find((x) => x.user_plan_id === card.dataset.id);
  const err = card.querySelector('[data-error]');

  const save = e.target.closest('[data-save]');
  if (save) {
    const entries = readEntries(card);
    if (!entries.length) { err.textContent = 'Enter at least one number first.'; return; }
    save.disabled = true; err.textContent = '';
    try {
      await api.post(`/plans/${p.user_plan_id}/exercise-log`, { entries });
      entries.forEach((en) => { p.today_values[en.exercise_key] = en.value; });
      save.textContent = 'Saved ✓';
      setTimeout(() => { save.textContent = 'Save numbers'; save.disabled = false; }, 1600);
    } catch (ex) { err.textContent = errorText(ex.message); save.disabled = false; }
    return;
  }

  const miss = e.target.closest('[data-miss]');
  if (miss) {
    if (!miss.classList.contains('is-confirming')) {
      miss.classList.add('is-confirming'); miss.textContent = 'Tap again to confirm';
      setTimeout(() => { miss.classList.remove('is-confirming'); miss.textContent = 'I missed today'; }, 4000);
      return;
    }
    try {
      const r = await api.post(`/plans/${p.user_plan_id}/checkin`, { status: 'missed' });
      p.already_logged_today = true; p.current_streak = r.current_streak ?? 0;
      replaceCard(p);
    } catch (ex) { err.textContent = errorText(ex.message); }
  }
});

export async function initDashboard(user) {
  const now = new Date();
  document.getElementById('today-date').textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const hour = now.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  document.getElementById('greeting').innerHTML = `${hello}, <em>${esc((user.display_name || '').split(' ')[0])}.</em>`;
  try {
    plans = (await api.get('/plans/mine')).filter((p) => !p.is_abandoned);
    render();
    loadCoachMessages();
  } catch (ex) {
    errEl.textContent = errorText(ex.message);
  }
}