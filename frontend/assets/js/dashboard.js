/**
 * Dashboard: one glass card per plan.
 * - Blue's suggestions (up to 3, based on your progress) sit right under the plan name
 * - The circle checkbox marks today complete (athletes: saves their numbers too)
 * - Blue's daily message loads per plan (AI when configured, templates otherwise)
 * - "I missed today" needs a second tap to confirm (it resets the streak)
 */

import { api, errorText } from './modules/api-client.js';

const MAX_PLANS = 3;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const listEl = document.getElementById('plans');
const errEl = document.getElementById('dash-error');
let plans = [];

// Athlete goals are stored as "Sport — target"; the sport already shows as a badge.
const cleanGoal = (p) => (
  p.sport_label && p.goal_text.startsWith(`${p.sport_label} — `)
    ? p.goal_text.slice(p.sport_label.length + 3)
    : p.goal_text
);

// AI-written plan name when there is one; older plans fall back to the goal text.
const headline = (p) => (
  p.plan_type !== 'catalog' && p.title && p.title !== p.goal_text
    ? p.title
    : cleanGoal(p)
);

const phaseShort = (p) => (
  p.phase_label ? p.phase_label.split('—')[0].trim() : ''
);

// Short chip text for each kind of suggestion Blue can give.
const TIP_LABEL = {
  food: 'Food',
  train: 'Training',
  recovery: 'Recovery',
  habit: 'Habit',
  focus: 'Focus',
  craving: 'Cravings',
  swap: 'Swap',
  routine: 'Routine',
  social: 'People',
  body: 'Body',
  mindset: 'Mindset',
};

// Blue's suggestions. p.tips === undefined means "not loaded yet" (shimmer).
// [] means "nothing to show".
function tipsHtml(p) {
  if (p.is_completed || p.is_abandoned) return '';

  if (!p.tips) {
    return `<div class="tips is-loading" aria-busy="true">
      <p class="tips__label">
        <span class="blue-dot" aria-hidden="true"></span>
        Blue is reading your progress…
      </p>
      <ul class="tips__list" aria-hidden="true">
        <li></li><li></li><li></li>
      </ul>
    </div>`;
  }

  if (!p.tips.length) return '';

  return `<div class="tips">
    <p class="tips__label">
      <span class="blue-dot" aria-hidden="true"></span>
      Blue suggests
    </p>
    <ul class="tips__list">${p.tips.map((t) =>
      `<li class="tip">
        <span class="tip__kind tip__kind--${esc(t.k)}">${esc(TIP_LABEL[t.k] || 'Tip')}</span>
        <span class="tip__text">${esc(t.t)}</span>
      </li>`
    ).join('')}</ul>
  </div>`;
}

// ---- Athlete numbers: usual day summary + optional "changed today" steppers ----

const STEP = {
  reps: 1,
  weight_kg: 2.5,
  duration_min: 1,
  distance_km: 0.5,
  rounds: 1,
  count: 1
};

const hasDefault = (ex) => Number(ex.default) > 0;
const fmtNum = (n) => String(Math.round(Number(n) * 100) / 100);

function exerciseBlock(p) {
  if (p.plan_type !== 'athletic' || !p.tracked_exercises.length) return '';

  const done = p.already_logged_today || p.is_completed;

  const rows = p.tracked_exercises.map((ex) => {
    const logged = p.today_values?.[ex.key];
    const shown = done && logged !== undefined ? logged : ex.default;

    const changed = done
      && logged !== undefined
      && hasDefault(ex)
      && Number(logged) !== Number(ex.default);

    return `<li class="num-row${changed ? ' is-changed' : ''}">
      <span class="num-row__name">${esc(ex.label)}</span>
      <span class="num-row__val">
        ${shown != null && shown !== '' ? esc(fmtNum(shown)) : '–'}
        <small>${esc(ex.unit)}</small>
      </span>
    </li>`;
  }).join('');

  const edit = done ? '' : `
    <div class="num-edit" data-edit hidden>
      <p class="nums__label">What did you do today?</p>
      <div class="num-edit__grid">${p.tracked_exercises.map((ex) => {
        const start = p.today_values?.[ex.key]
          ?? (hasDefault(ex) ? ex.default : '');

        return `<div class="def-row" data-step="${STEP[ex.metric] || 1}">
          <div class="def-row__name">
            <span>${esc(ex.label)}</span>
            <small>${esc(ex.unit)}</small>
          </div>
          <div class="stepper">
            <button
              class="stepper__btn"
              type="button"
              data-dir="-1"
              aria-label="Decrease ${esc(ex.label)}"
            >−</button>
            <input
              type="number"
              inputmode="decimal"
              min="0"
              step="any"
              data-key="${esc(ex.key)}"
              value="${esc(start)}"
              placeholder="0"
              aria-label="${esc(ex.label)} today in ${esc(ex.unit)}"
            >
            <button
              class="stepper__btn"
              type="button"
              data-dir="1"
              aria-label="Increase ${esc(ex.label)}"
            >+</button>
          </div>
        </div>`;
      }).join('')}</div>
      <button class="btn btn--solid btn--sm" type="button" data-log-nums>
        Log today's numbers
      </button>
    </div>`;

  return `<div class="nums">
    <p class="nums__label">${done ? 'Today' : 'Your usual day'}</p>
    <ul class="num-list">${rows}</ul>
    ${edit}
  </div>`;
}

function cardHtml(p) {
  const pct = Math.min(
    100,
    Math.round((p.day_number / p.total_days) * 100)
  );

  const athlete = p.plan_type === 'athletic';
  const done = p.already_logged_today || p.is_completed;

  const coach = p.is_completed ? '' : `
    <div class="coach ${p.coach_message ? '' : 'is-loading'}" data-coach>
      <p class="coach__label">Blue</p>
      <p class="coach__text">${esc(
        p.coach_message || 'Blue is writing today’s message…'
      )}</p>
    </div>`;

  const usual = athlete && p.tracked_exercises.some(hasDefault);

  const checkLabel = p.is_completed
    ? 'Plan complete'
    : done
      ? (athlete ? 'Done for today' : 'Marked as on track')
      : usual
        ? 'I did my usual numbers today'
        : "Yes, I'm on track today";

  const video = p.video_checkin_frequency && !p.is_completed
    ? `<a class="btn btn--text btn--sm" href="progress.html?plan=${esc(p.user_plan_id)}#video">Video check-in</a>`
    : '';

  return `
  <article class="plan liquid-glass liquid-glass--panel ${done ? 'is-done' : ''}" data-id="${esc(p.user_plan_id)}">
    <div class="plan__top">
      <span class="badge ${athlete ? 'badge--athlete' : ''}">
        ${athlete ? esc(p.sport_label || 'Athlete') : 'Personal'}
      </span>
      <span class="plan__day">Day ${p.day_number} of ${p.total_days}</span>
    </div>

    <h2 class="plan__title">${esc(headline(p))}</h2>

    ${(phaseShort(p) || headline(p) !== cleanGoal(p))
      ? `<p class="plan__sub">${esc(
          [phaseShort(p), cleanGoal(p)]
            .filter((x) => x && x !== headline(p))
            .join(' · ')
        )}</p>`
      : ''}

    <div data-tips>${tipsHtml(p)}</div>

    <div class="meter" role="progressbar"
      aria-valuemin="0"
      aria-valuemax="100"
      aria-valuenow="${pct}">
      <i style="width:${pct}%"></i>
    </div>

    <div class="plan__stats">
      <span>Streak <b>${p.current_streak}</b></span>
      <span>Best <b>${p.longest_streak}</b></span>
    </div>

    ${coach}

    ${!p.is_completed && p.micro_goal
      ? `<p class="today__goal">${esc(p.micro_goal)}</p>`
      : ''}

    ${!p.is_completed && p.identity_cue
      ? `<p class="today__cue">${esc(p.identity_cue)}</p>`
      : ''}

    ${exerciseBlock(p)}

    <p class="error" data-error role="alert"></p>

    <div class="plan__actions">
      <label class="q-check q-check--lg">
        <input type="checkbox" data-done ${done ? 'checked disabled' : ''}>
        <span class="q-check__box"></span>
        <span class="q-check__label">${checkLabel}</span>
      </label>

      <div class="plan__links">
        ${athlete && !done && p.tracked_exercises.length
          ? '<button class="btn btn--glass liquid-glass btn--sm" type="button" data-edit-toggle>Numbers changed today?</button>'
          : ''}

        ${!done
          ? '<button class="btn btn--text btn--sm" type="button" data-miss>I missed today</button>'
          : ''}

        ${video}

        <a class="btn btn--text btn--sm" href="progress.html?plan=${esc(p.user_plan_id)}">Progress</a>

        ${!p.is_completed
          ? '<button class="btn btn--exit btn--sm" type="button" data-exit>Exit plan</button>'
          : ''}
      </div>
    </div>
  </article>`;
}

function render() {
  const active = plans.filter(
    (p) => !p.is_abandoned && !p.is_completed
  ).length;

  document.getElementById('new-plan').hidden = active >= MAX_PLANS;

  if (!plans.length) {
    listEl.innerHTML = `<div class="empty liquid-glass liquid-glass--panel">
      <h2 class="h3">No plan yet</h2>
      <p>Pick athlete or personal coaching and Blue will take it from there.</p>
      <a class="btn btn--solid" href="plans.html">Build my first plan</a>
    </div>`;
    return;
  }

  listEl.innerHTML = plans.map(cardHtml).join('');
}

function weekRange(week) {
  const fmt = (value) => new Date(`${value}T00:00:00`)
    .toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });

  return `${fmt(week.start)} – ${fmt(week.end)}`;
}

function progressInsight(summary) {
  if (!summary.completed_total) {
    return 'Your first completed check-in will start your progress trend.';
  }

  if (summary.prev7_pct !== null && summary.prev7_pct !== undefined) {
    const change = Number(summary.last7_pct) - Number(summary.prev7_pct);

    if (change > 0) {
      return `Your check-ins are up ${change} points from the previous week. Keep building on that rhythm.`;
    }

    if (change < 0) {
      return `Your check-ins are down ${Math.abs(change)} points from the previous week. A small step today can restart the rhythm.`;
    }

    return `Your check-in pace held steady at ${summary.last7_pct}% this week. Consistency is progress.`;
  }

  return `You completed ${summary.completed_total} of ${summary.days_elapsed} plan days (${summary.adherence_pct}%) so far. Another week of history will reveal your trend.`;
}

function insightCard(plan, analytics) {
  if (!analytics?.summary || !Array.isArray(analytics.weekly)) {
    return `<article class="insight-plan">
      <h3>${esc(headline(plan))}</h3>
      <p class="field__hint">Progress details couldn't load.</p>
    </article>`;
  }

  const summary = analytics.summary;

  if (!summary.completed_total) {
    return `<article class="insight-plan">
      <div class="insight-plan__head">
        <h3>${esc(headline(plan))}</h3>
        <span class="insight-plan__rate">No check-ins yet</span>
      </div>
      <p class="insight-plan__text">${esc(progressInsight(summary))}</p>
    </article>`;
  }

  const bars = analytics.weekly.slice(-8).map((week) => {
    const pct = Math.max(0, Math.min(100, Number(week.pct) || 0));
    const completed = Number(week.completed) || 0;
    const possible = Number(week.possible) || 0;

    return `<li class="insight-chart__week"
      aria-label="${esc(weekRange(week))}: ${completed} of ${possible} completed">
      <div class="insight-chart__track" aria-hidden="true">
        <span style="height:${pct}%"></span>
      </div>
      <span class="insight-chart__value">${completed}/${possible}</span>
      <span class="insight-chart__label">${esc(
        new Date(`${week.start}T00:00:00`).toLocaleDateString(
          undefined,
          { month: 'short', day: 'numeric' }
        )
      )}</span>
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
      return {
        plan,
        analytics: await api.get(`/plans/${plan.user_plan_id}/analytics`)
      };
    } catch {
      return { plan, analytics: null };
    }
  }));

  host.innerHTML = results
    .map(({ plan, analytics }) => insightCard(plan, analytics))
    .join('');
}

function replaceCard(p) {
  const old = listEl.querySelector(
    `[data-id="${CSS.escape(p.user_plan_id)}"]`
  );

  if (old) old.outerHTML = cardHtml(p);
}

function readEntries(card) {
  return [...card.querySelectorAll('.num-edit input[data-key]')]
    .filter((i) => i.value !== '' && Number(i.value) >= 0)
    .map((i) => ({
      exercise_key: i.dataset.key,
      value: Number(i.value)
    }));
}

async function loadCoachMessages() {
  await Promise.all(
    plans
      .filter((p) => !p.coach_message && !p.is_completed && !p.is_abandoned)
      .map(async (p) => {
        try {
          const { message } = await api.get(
            `/plans/${p.user_plan_id}/coach-message`
          );

          if (message) p.coach_message = message;
        } catch {
          // Keep the placeholder text out: fall back to nothing.
        }

        const box = listEl.querySelector(
          `[data-id="${CSS.escape(p.user_plan_id)}"] [data-coach]`
        );

        if (!box) return;

        if (p.coach_message) {
          box.classList.remove('is-loading');
          box.querySelector('.coach__text').textContent = p.coach_message;
        } else {
          box.remove();
        }
      })
  );
}

// Blue's suggestions for every plan that doesn't have them yet.
async function loadTips() {
  await Promise.all(
    plans
      .filter((p) => !p.tips && !p.is_completed && !p.is_abandoned)
      .map(async (p) => {
        try {
          p.tips = (await api.get(`/plans/${p.user_plan_id}/blue`)).tips || [];
        } catch {
          p.tips = [];
        }

        const box = listEl.querySelector(
          `[data-id="${CSS.escape(p.user_plan_id)}"] [data-tips]`
        );

        if (box) box.innerHTML = tipsHtml(p);
      })
  );
}

// Progress changed (check-in / missed day): re-render the card and ask Blue again.
function refreshAfterProgress(p) {
  p.tips = undefined;
  replaceCard(p);
  loadTips();
  loadDashboardInsights();
}

// One tap: the plan's usual numbers for every exercise that has a default.
const defaultEntries = (p) => p.tracked_exercises
  .filter(hasDefault)
  .map((ex) => ({
    exercise_key: ex.key,
    value: Number(ex.default)
  }));

async function complete(p, entries) {
  let result;

  if (entries.length) {
    ({ checkin: result } = await api.post(
      `/plans/${p.user_plan_id}/exercise-log`,
      { entries, checkin: true }
    ));

    entries.forEach((e) => {
      p.today_values[e.exercise_key] = e.value;
    });
  } else {
    result = await api.post(
      `/plans/${p.user_plan_id}/checkin`,
      { status: 'completed' }
    );
  }

  p.already_logged_today = true;

  if (result) {
    p.current_streak = result.current_streak;
    p.longest_streak = Math.max(
      p.longest_streak,
      result.longest_streak ?? result.current_streak
    );
    p.is_completed = !!result.is_completed;
  }
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
    await complete(
      p,
      p.plan_type === 'athletic' ? defaultEntries(p) : []
    );

    refreshAfterProgress(p);
  } catch (ex) {
    box.checked = false;
    box.disabled = false;

    if (ex.message === 'already_logged_today') {
      p.already_logged_today = true;
      replaceCard(p);
      return;
    }

    err.textContent = errorText(ex.message);
  }
});

listEl.addEventListener('click', async (e) => {
  const card = e.target.closest('.plan');
  if (!card) return;

  const p = plans.find((x) => x.user_plan_id === card.dataset.id);
  const err = card.querySelector('[data-error]');

  // Increase or decrease exercise numbers.
  const bump = e.target.closest('.stepper__btn');

  if (bump) {
    const row = bump.closest('.def-row');
    const input = row.querySelector('input');
    const step = Number(row.dataset.step) || 1;

    input.value = String(
      Math.max(
        0,
        Math.round(
          ((Number(input.value) || 0)
            + step * Number(bump.dataset.dir)) * 100
        ) / 100
      )
    );

    return;
  }

  // Show or hide the custom number editor.
  const toggle = e.target.closest('[data-edit-toggle]');

  if (toggle) {
    const panel = card.querySelector('[data-edit]');
    const open = panel.hidden;

    panel.hidden = !open;
    card.classList.toggle('is-editing', open);
    toggle.textContent = open ? 'Cancel' : 'Numbers changed today?';

    return;
  }

  // Save today's actual exercise numbers and complete the check-in.
  const logNums = e.target.closest('[data-log-nums]');

  if (logNums) {
    const entries = readEntries(card);

    if (!entries.length) {
      err.textContent = 'Enter at least one number first.';
      return;
    }

    logNums.disabled = true;
    err.textContent = '';

    try {
      await complete(p, entries);
      refreshAfterProgress(p);
    } catch (ex) {
      logNums.disabled = false;

      if (ex.message === 'already_logged_today') {
        p.already_logged_today = true;
        replaceCard(p);
        return;
      }

      err.textContent = errorText(ex.message);
    }

    return;
  }

  // Exit a plan; requires a second tap for confirmation.
  const exit = e.target.closest('[data-exit]');

  if (exit) {
    if (!exit.classList.contains('is-confirming')) {
      exit.classList.add('is-confirming');
      exit.textContent = 'Tap again to exit';

      setTimeout(() => {
        exit.classList.remove('is-confirming');
        exit.textContent = 'Exit plan';
      }, 4000);

      return;
    }

    exit.disabled = true;

    try {
      await api.post(`/plans/${p.user_plan_id}/abandon`);

      plans = plans.filter(
        (x) => x.user_plan_id !== p.user_plan_id
      );

      render();
      loadDashboardInsights();
    } catch (ex) {
      err.textContent = errorText(ex.message);
      exit.disabled = false;
    }

    return;
  }

  // Mark a day as missed; requires a second tap for confirmation.
  const miss = e.target.closest('[data-miss]');

  if (miss) {
    if (!miss.classList.contains('is-confirming')) {
      miss.classList.add('is-confirming');
      miss.textContent = 'Tap again to confirm';

      setTimeout(() => {
        miss.classList.remove('is-confirming');
        miss.textContent = 'I missed today';
      }, 4000);

      return;
    }

    try {
      const r = await api.post(
        `/plans/${p.user_plan_id}/checkin`,
        { status: 'missed' }
      );

      p.already_logged_today = true;
      p.current_streak = r.current_streak ?? 0;

      refreshAfterProgress(p);
    } catch (ex) {
      err.textContent = errorText(ex.message);
    }
  }
});

export async function initDashboard(user) {
  const now = new Date();

  document.getElementById('today-date').textContent =
    now.toLocaleDateString(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });

  const hour = now.getHours();

  const hello = hour < 12
    ? 'Good morning'
    : hour < 18
      ? 'Good afternoon'
      : 'Good evening';

  document.getElementById('greeting').innerHTML =
    `${hello}, <em>${esc((user.display_name || '').split(' ')[0])}.</em>`;

  try {
    plans = (await api.get('/plans/mine'))
      .filter((p) => !p.is_abandoned);

    render();
    loadDashboardInsights();
    loadCoachMessages();
    loadTips();
  } catch (ex) {
    errEl.textContent = errorText(ex.message);
  }
}