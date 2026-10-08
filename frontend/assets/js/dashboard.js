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
// AI-written plan name when there is one; older plans fall back to the goal text.
const headline = (p) => (p.plan_type !== 'catalog' && p.title && p.title !== p.goal_text ? p.title : cleanGoal(p));
const phaseShort = (p) => (p.phase_label ? p.phase_label.split('—')[0].trim() : '');
const TIP_LABEL = { food: 'Food', train: 'Training', recovery: 'Recovery', habit: 'Habit', focus: 'Focus' };

function tipsHtml(p) {
  if (p.is_completed || !p.tips?.length) return '';
  return `<div class="tips"><p class="tips__label">Picked for you</p><ul class="tips__list">${p.tips.map((t) =>
    `<li class="tip"><span class="tip__kind tip__kind--${esc(t.k)}">${esc(TIP_LABEL[t.k] || 'Tip')}</span><span class="tip__text">${esc(t.t)}</span></li>`).join('')}</ul></div>`;
}


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
        <h2 class="plan__title">${esc(headline(p))}</h2>
    ${(phaseShort(p) || headline(p) !== cleanGoal(p)) ? `<p class="plan__sub">${esc([phaseShort(p), cleanGoal(p)].filter((x) => x && x !== headline(p)).join(' · '))}</p>` : ''}
    <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div>
    <div class="plan__stats"><span>Streak <b>${p.current_streak}</b></span><span>Best <b>${p.longest_streak}</b></span></div>
    ${coach}
    <div data-tips>${tipsHtml(p)}</div>
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
        ${!p.is_completed ? '<button class="btn btn--exit btn--sm" type="button" data-exit>Exit plan</button>' : ''}
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

function weekRange(week) {
  const fmt = (value) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${fmt(week.start)} – ${fmt(week.end)}`;
}

function progressInsight(summary) {
  if (!summary.completed_total) {
    return 'Your first completed check-in will start your progress trend.';
  }

  if (summary.prev7_pct !== null && summary.prev7_pct !== undefined) {
    const change = Number(summary.last7_pct) - Number(summary.prev7_pct);
    if (change > 0) return `Your check-ins are up ${change} points from the previous week. Keep building on that rhythm.`;
    if (change < 0) return `Your check-ins are down ${Math.abs(change)} points from the previous week. A small step today can restart the rhythm.`;
    return `Your check-in pace held steady at ${summary.last7_pct}% this week. Consistency is progress.`;
  }

  return `You completed ${summary.completed_total} of ${summary.days_elapsed} plan days (${summary.adherence_pct}%) so far. Another week of history will reveal your trend.`;
}

function insightCard(plan, analytics) {
  if (!analytics?.summary || !Array.isArray(analytics.weekly)) {
    return `<article class="insight-plan"><h3>${esc(headline(plan))}</h3><p class="field__hint">Progress details couldn't load.</p></article>`;
  }

  const summary = analytics.summary;
  if (!summary.completed_total) {
    return `<article class="insight-plan">
      <div class="insight-plan__head"><h3>${esc(headline(plan))}</h3><span class="insight-plan__rate">No check-ins yet</span></div>
      <p class="insight-plan__text">${esc(progressInsight(summary))}</p>
    </article>`;
  }

  const bars = analytics.weekly.slice(-8).map((week) => {
    const pct = Math.max(0, Math.min(100, Number(week.pct) || 0));
    const completed = Number(week.completed) || 0;
    const possible = Number(week.possible) || 0;

    return `<li class="insight-chart__week" aria-label="${esc(weekRange(week))}: ${completed} of ${possible} completed">
      <div class="insight-chart__track" aria-hidden="true"><span style="height:${pct}%"></span></div>
      <span class="insight-chart__value">${completed}/${possible}</span>
      <span class="insight-chart__label">${esc(new Date(`${week.start}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>
    </li>`;
  }).join('');

  return `<article class="insight-plan">
    <div class="insight-plan__head">
      <h3>${esc(headline(plan))}</h3>
      <span class="insight-plan__rate">${Number(summary.adherence_pct) || 0}% overall</span>
    </div>
    <p class="insight-plan__text">${esc(progressInsight(summary))}</p>
    <ol class="insight-chart" aria-label="Weekly completed check-ins">${bars}</ol>
  </article>`;
}

async function loadDashboardInsights() {
  const section = document.getElementById('dashboard-insights');
  const host = document.getElementById('dashboard-insight-list');
  const visiblePlans = plans.filter((plan) => !plan.is_abandoned);

  if (!visiblePlans.length) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  host.innerHTML = '<p class="field__hint">Loading your progress…</p>';

  const results = await Promise.all(visiblePlans.map(async (plan) => {
    try {
      return { plan, analytics: await api.get(`/plans/${plan.user_plan_id}/analytics`) };
    } catch {
      return { plan, analytics: null };
    }
  }));

  host.innerHTML = results
    .map(({ plan, analytics }) => insightCard(plan, analytics))
    .join('');
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

async function loadTips() {
  await Promise.all(plans.filter((p) => !p.tips && !p.is_completed && !p.is_abandoned).map(async (p) => {
    try { p.tips = (await api.get(`/plans/${p.user_plan_id}/insights`)).tips || []; } catch { p.tips = []; }
    const box = listEl.querySelector(`[data-id="${CSS.escape(p.user_plan_id)}"] [data-tips]`);
    if (box) box.innerHTML = tipsHtml(p);
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
    loadDashboardInsights();
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

  const exit = e.target.closest('[data-exit]');
  if (exit) {
    if (!exit.classList.contains('is-confirming')) {
      exit.classList.add('is-confirming'); exit.textContent = 'Tap again to exit';
      setTimeout(() => { exit.classList.remove('is-confirming'); exit.textContent = 'Exit plan'; }, 4000);
      return;
    }
    exit.disabled = true;
    try {
      await api.post(`/plans/${p.user_plan_id}/abandon`);
      plans = plans.filter((x) => x.user_plan_id !== p.user_plan_id);
      render();
      loadDashboardInsights();
    } catch (ex) { err.textContent = errorText(ex.message); exit.disabled = false; }
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
      loadDashboardInsights();
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
    loadDashboardInsights();
    loadCoachMessages();
    loadTips();
  } catch (ex) {
    errEl.textContent = errorText(ex.message);
  }
}