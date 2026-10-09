/**
 * Dashboard v3: plan covers + expandable details.
 *
 * COVER (always visible): badge, title, day, progress meter, streak / best,
 *   today's status pill and a one-line progress insight with a mini weekly chart.
 * OPENED (tap a cover): three tabs
 *   Today          check-in circle, Blue's message, today's numbers, off day, missed
 *   Insights       adherence tiles + weekly chart
 *   Blue suggests  AI suggestions
 *
 * Blue's message and suggestions load only when a plan is opened (fewer AI calls).
 * One plan is open at a time.
 */

import { api, errorText } from './modules/api-client.js';

const MAX_PLANS = 3;

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']; // Python weekday(): Monday = 0
const OFF_ERRORS = {
  off_day_limit: 'You can rest up to 2 days a week.',
  last_day_cannot_be_off: "The last day of your plan can't be an off day.",
  already_logged_today: 'Today is already logged.',
  off_days_athletes_only: 'Off days are for athlete plans.',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const clamp = (n) => Math.max(0, Math.min(100, Number(n) || 0));

const listEl = document.getElementById('plans');
const errEl = document.getElementById('dash-error');
let plans = [];

const cardEl = (p) => listEl.querySelector(`[data-id="${CSS.escape(p.user_plan_id)}"]`);

/* ---------------------------------------------------------------- naming */

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

/* ------------------------------------------------------- today's status */

function todayState(p) {
  const athlete = p.plan_type === 'athletic';
  const done = !!(p.already_logged_today || p.is_completed);
  const isOff = athlete && !!p.off_day?.is_off_today;
  return { athlete, done, isOff };
}

function statusPill(p) {
  const { athlete, done, isOff } = todayState(p);
  if (p.is_completed) return ['done', 'Plan complete'];
  if (done) return ['done', athlete ? 'Done today' : 'On track today'];
  if (isOff) return ['rest', 'Rest day'];
  return ['todo', 'Not logged yet'];
}

function offNote(p) {
  const o = p.off_day;
  if (!o || p.is_completed) return '';
  if (o.is_off_today) return '<p class="off-note is-on">Rest day. Your streak is safe, so recover well.</p>';
  if (typeof o.weekday === 'number') {
    return `<p class="off-note">Blue's off day: ${WEEKDAYS[o.weekday]}s${o.reason ? ' · ' + esc(o.reason) : ''}</p>`;
  }
  return '';
}

/* ------------------------------------------------------ Blue suggestions */

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

// p.tips === undefined means "not loaded yet" (shimmer). [] means "nothing to show".
function tipsHtml(p) {
  if (p.is_completed || p.is_abandoned) return '';

  if (!p.tips) {
    return `<div class="tips is-loading" aria-busy="true">
      <p class="tips__label"><span class="blue-dot" aria-hidden="true"></span>Blue is reading your progress…</p>
      <ul class="tips__list" aria-hidden="true"><li></li><li></li><li></li></ul>
    </div>`;
  }

  if (!p.tips.length) return '';

  return `<div class="tips">
    <p class="tips__label"><span class="blue-dot" aria-hidden="true"></span>Blue suggests</p>
    <ul class="tips__list">${p.tips.map((t) =>
      `<li class="tip">
        <span class="tip__kind tip__kind--${esc(t.k)}">${esc(TIP_LABEL[t.k] || 'Tip')}</span>
        <span class="tip__text">${esc(t.t)}</span>
      </li>`
    ).join('')}</ul>
  </div>`;
}

const tipsPane = (p) => tipsHtml(p)
  || '<p class="pane-empty">No suggestions right now. Keep checking in and Blue will adapt.</p>';

/* ------------------------------------------------------ athlete numbers */

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
  if (p.plan_type !== 'athletic' || !p.tracked_exercises?.length) return '';

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
            <button class="stepper__btn" type="button" data-dir="-1" aria-label="Decrease ${esc(ex.label)}">−</button>
            <input type="number" inputmode="decimal" min="0" step="any"
              data-key="${esc(ex.key)}" value="${esc(start)}" placeholder="0"
              aria-label="${esc(ex.label)} today in ${esc(ex.unit)}">
            <button class="stepper__btn" type="button" data-dir="1" aria-label="Increase ${esc(ex.label)}">+</button>
          </div>
        </div>`;
      }).join('')}</div>
      <button class="btn btn--solid btn--sm" type="button" data-log-nums>Log today's numbers</button>
    </div>`;

  return `<div class="nums">
    <p class="nums__label">${done ? 'Today' : 'Your usual day'}</p>
    <ul class="num-list">${rows}</ul>
    ${edit}
  </div>`;
}

/* -------------------------------------------------------------- insights */

function weekRange(week) {
  const fmt = (value) => new Date(`${value}T00:00:00`)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

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

const analyticsOk = (a) => !!(a?.summary && Array.isArray(a.weekly));

// One-line insight + tiny weekly bars, shown on the cover.
function coverInsight(p) {
  const a = p._an;

  if (a === undefined) {
    return `<div class="cover-insight is-loading" aria-busy="true">
      <div class="cover-insight__copy"><p class="cover-insight__text">Reading your rhythm…</p></div>
    </div>`;
  }

  if (!analyticsOk(a)) return '';

  const s = a.summary;

  const bars = s.completed_total
    ? `<ol class="mini-bars" aria-hidden="true">${a.weekly.slice(-8).map((w) =>
        `<li><span style="height:${clamp(w.pct)}%"></span></li>`
      ).join('')}</ol>`
    : '';

  return `<div class="cover-insight">
    <div class="cover-insight__copy">
      <p class="cover-insight__label">Insight</p>
      <p class="cover-insight__text">${esc(progressInsight(s))}</p>
    </div>
    ${bars}
  </div>`;
}

// Full insight view, shown in the Insights tab.
function insightsHtml(p) {
  const a = p._an;

  if (a === undefined) return '<p class="pane-empty">Loading your progress…</p>';
  if (!analyticsOk(a)) return '<p class="pane-empty">Progress details couldn’t load.</p>';

  const s = a.summary;

  if (!s.completed_total) {
    return `<p class="pane-empty">${esc(progressInsight(s))}</p>`;
  }

  const last7 = s.last7_pct !== null && s.last7_pct !== undefined ? `${Number(s.last7_pct)}%` : '–';

  const bars = a.weekly.slice(-8).map((week) => {
    const completed = Number(week.completed) || 0;
    const possible = Number(week.possible) || 0;

    return `<li class="insight-chart__week" aria-label="${esc(weekRange(week))}: ${completed} of ${possible} completed">
      <div class="insight-chart__track" aria-hidden="true"><span style="height:${clamp(week.pct)}%"></span></div>
      <span class="insight-chart__value">${completed}/${possible}</span>
      <span class="insight-chart__label">${esc(new Date(`${week.start}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))}</span>
    </li>`;
  }).join('');

  return `
    <div class="ins-tiles">
      <div class="ins-tile"><p class="ins-tile__label">Overall</p><p class="ins-tile__value">${Number(s.adherence_pct) || 0}%</p></div>
      <div class="ins-tile"><p class="ins-tile__label">Last 7 days</p><p class="ins-tile__value">${last7}</p></div>
      <div class="ins-tile"><p class="ins-tile__label">Done</p><p class="ins-tile__value">${Number(s.completed_total) || 0}/${Number(s.days_elapsed) || 0}</p></div>
    </div>
    <p class="ins-text">${esc(progressInsight(s))}</p>
    <div class="ins-chart">
      <p class="ins-chart__title">Completed check-ins by week</p>
      <ol class="insight-chart" aria-label="Weekly completed check-ins">${bars}</ol>
    </div>`;
}

/* ------------------------------------------------------------- the card */

const TABS = [['today', 'Today'], ['insights', 'Insights'], ['blue', 'Blue suggests']];

const tabsFor = (p) => (p.is_completed ? TABS.filter(([k]) => k === 'insights') : TABS);

function tabOf(p) {
  const keys = tabsFor(p).map(([k]) => k);
  return keys.includes(p._tab) ? p._tab : keys[0];
}

function todayPane(p) {
  const { athlete, done, isOff } = todayState(p);
  const usual = athlete && p.tracked_exercises?.some(hasDefault);

  const coach = p.coach_message || !p._coachFailed
    ? `<div class="coach ${p.coach_message ? '' : 'is-loading'}" data-coach>
        <p class="coach__label">Blue</p>
        <p class="coach__text">${esc(p.coach_message || 'Blue is writing today’s message…')}</p>
      </div>`
    : '';

  const offToggle = athlete && !done
    ? `<button class="btn btn--glass liquid-glass btn--sm btn--off${isOff ? ' is-on' : ''}"
         type="button" data-off aria-pressed="${isOff}">${isOff ? 'Remove off day' : 'Add off day'}</button>`
    : '';

  const checkLabel = done
    ? (athlete ? 'Done for today' : 'Marked as on track')
    : usual
      ? 'I did my usual numbers today'
      : "Yes, I'm on track today";

  return `
    ${coach}
    ${p.micro_goal ? `<p class="today__goal">${esc(p.micro_goal)}</p>` : ''}
    ${p.identity_cue ? `<p class="today__cue">${esc(p.identity_cue)}</p>` : ''}
    ${exerciseBlock(p)}
    ${offNote(p)}
    <div class="today-actions">
      <div class="plan__primary">
        <label class="q-check q-check--lg">
          <input type="checkbox" data-done ${done ? 'checked disabled' : ''}>
          <span class="q-check__box"></span>
          <span class="q-check__label">${checkLabel}</span>
        </label>
        ${offToggle}
      </div>
      <div class="plan__links">
        ${athlete && !done && p.tracked_exercises?.length
          ? '<button class="btn btn--glass liquid-glass btn--sm" type="button" data-edit-toggle>Numbers changed today?</button>'
          : ''}
        ${!done && !isOff
          ? '<button class="btn btn--text btn--sm" type="button" data-miss>I missed today</button>'
          : ''}
      </div>
    </div>`;
}

function cardHtml(p) {
  const pct = clamp((p.day_number / p.total_days) * 100);
  const { athlete, done } = todayState(p);
  const [stateKey, stateText] = statusPill(p);
  const id = esc(p.user_plan_id);
  const open = !!p._open;
  const tabs = tabsFor(p);
  const active = tabOf(p);

  const panes = {
    today: () => todayPane(p),
    insights: () => `<div data-insights>${insightsHtml(p)}</div>`,
    blue: () => `<div data-tips>${tipsPane(p)}</div>`,
  };

  const tabBar = tabs.length > 1
    ? `<div class="ptabs" role="tablist" aria-label="Plan sections">${tabs.map(([k, label]) =>
        `<button class="ptab${k === active ? ' is-active' : ''}" type="button" role="tab"
          aria-selected="${k === active}" data-tab="${k}">${label}</button>`
      ).join('')}</div>`
    : '';

  const paneHtml = tabs.map(([k]) =>
    `<div class="ppane" role="tabpanel" data-pane="${k}"${k === active ? '' : ' hidden'}>${panes[k]()}</div>`
  ).join('');

  const video = p.video_checkin_frequency && !p.is_completed
    ? `<a class="btn btn--text btn--sm" href="progress.html?plan=${id}#video">Video check-in</a>`
    : '';

  const subParts = [phaseShort(p), cleanGoal(p)].filter((x) => x && x !== headline(p));

  return `
  <article class="pcard liquid-glass liquid-glass--panel${done ? ' is-done' : ''}${open ? ' is-open' : ''}" data-id="${id}">
    <div class="pcard__cover" data-cover>
      <div class="plan__top">
        <span class="badge ${athlete ? 'badge--athlete' : ''}">${athlete ? esc(p.sport_label || 'Athlete') : 'Personal'}</span>
        <span class="plan__day">Day ${p.day_number} of ${p.total_days}</span>
      </div>

      <h2 class="plan__title">${esc(headline(p))}</h2>
      ${subParts.length ? `<p class="plan__sub">${esc(subParts.join(' · '))}</p>` : ''}

      <div class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
        <i style="width:${pct}%"></i>
      </div>

      <div class="cover-meta">
        <div class="plan__stats">
          <span>Streak <b>${p.current_streak}</b></span>
          <span>Best <b>${p.longest_streak}</b></span>
        </div>
        <span class="pill pill--${stateKey}">${esc(stateText)}</span>
      </div>

      <div data-cover-insight>${coverInsight(p)}</div>

      <button class="pcard__toggle" type="button" data-toggle aria-expanded="${open}" aria-controls="d-${id}">
        <span data-toggle-label>${open ? 'Hide details' : 'Open plan'}</span>
        <span class="pcard__chev" aria-hidden="true"></span>
      </button>
    </div>

    <div class="pcard__details" id="d-${id}" data-details>
      <div class="pcard__details-inner">
        <div class="pcard__body">
          ${tabBar}
          ${paneHtml}
          <p class="error" data-error role="alert"></p>
          <div class="pcard__foot">
            <div class="plan__links">
              <a class="btn btn--glass liquid-glass btn--sm" href="progress.html?plan=${id}">Full progress</a>
              ${video}
            </div>
            ${!p.is_completed ? '<button class="btn btn--exit btn--sm" type="button" data-exit>Exit plan</button>' : ''}
          </div>
        </div>
      </div>
    </div>
  </article>`;
}

function render() {
  const active = plans.filter((p) => !p.is_abandoned && !p.is_completed).length;

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

function replaceCard(p) {
  const old = cardEl(p);
  if (old) old.outerHTML = cardHtml(p);
}

/* ------------------------------------------------- open / close / tabs */

function setOpen(card, open) {
  card.classList.toggle('is-open', open);
  card.querySelector('[data-toggle]')?.setAttribute('aria-expanded', String(open));
  const label = card.querySelector('[data-toggle-label]');
  if (label) label.textContent = open ? 'Hide details' : 'Open plan';
}

function toggleCard(card, p) {
  const open = !card.classList.contains('is-open');

  listEl.querySelectorAll('.pcard.is-open').forEach((c) => {
    if (c !== card) setOpen(c, false);
  });

  plans.forEach((x) => { x._open = x === p ? open : false; });
  setOpen(card, open);

  if (open) {
    ensureLoaded(p);
    requestAnimationFrame(() => card.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }
}

function selectTab(card, p, key) {
  p._tab = key;

  card.querySelectorAll('[data-tab]').forEach((b) => {
    const on = b.dataset.tab === key;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });

  card.querySelectorAll('[data-pane]').forEach((el) => {
    el.hidden = el.dataset.pane !== key;
  });
}

/* --------------------------------------------------------- data loading */

function paintInsights(p) {
  const card = cardEl(p);
  if (!card) return;

  const cover = card.querySelector('[data-cover-insight]');
  if (cover) cover.innerHTML = coverInsight(p);

  const pane = card.querySelector('[data-insights]');
  if (pane) pane.innerHTML = insightsHtml(p);
}

async function loadAnalytics(p) {
  p._an = undefined;
  paintInsights(p);

  try {
    p._an = await api.get(`/plans/${p.user_plan_id}/analytics`);
  } catch {
    p._an = null;
  }

  paintInsights(p);
}

async function loadCoach(p) {
  if (p._coachBusy || p.coach_message || p.is_completed || p.is_abandoned) return;

  p._coachBusy = true;

  try {
    const { message } = await api.get(`/plans/${p.user_plan_id}/coach-message`);
    if (message) p.coach_message = message;
  } catch {
    // fall through: no message
  }

  p._coachBusy = false;
  if (!p.coach_message) p._coachFailed = true;

  const box = cardEl(p)?.querySelector('[data-coach]');
  if (!box) return;

  if (p.coach_message) {
    box.classList.remove('is-loading');
    box.querySelector('.coach__text').textContent = p.coach_message;
  } else {
    box.remove();
  }
}

async function loadTips(p) {
  if (p._tipsBusy || p.tips || p.is_completed || p.is_abandoned) return;

  p._tipsBusy = true;

  try {
    p.tips = (await api.get(`/plans/${p.user_plan_id}/blue`)).tips || [];
  } catch {
    p.tips = [];
  }

  p._tipsBusy = false;

  const box = cardEl(p)?.querySelector('[data-tips]');
  if (box) box.innerHTML = tipsPane(p);
}

// Blue (AI) is only asked when a plan is opened.
function ensureLoaded(p) {
  loadCoach(p);
  loadTips(p);
}

// Progress changed (check-in / missed day): re-render the card and ask again.
function refreshAfterProgress(p) {
  p.tips = undefined;
  p._tipsBusy = false;
  replaceCard(p);
  if (p._open) loadTips(p);
  loadAnalytics(p);
}

/* ------------------------------------------------------------ check-ins */

// One tap: the plan's usual numbers for every exercise that has a default.
const defaultEntries = (p) => (p.tracked_exercises || [])
  .filter(hasDefault)
  .map((ex) => ({ exercise_key: ex.key, value: Number(ex.default) }));

function readEntries(card) {
  return [...card.querySelectorAll('.num-edit input[data-key]')]
    .filter((i) => i.value !== '' && Number(i.value) >= 0)
    .map((i) => ({ exercise_key: i.dataset.key, value: Number(i.value) }));
}

async function complete(p, entries) {
  let result;

  if (entries.length) {
    ({ checkin: result } = await api.post(
      `/plans/${p.user_plan_id}/exercise-log`,
      { entries, checkin: true }
    ));

    p.today_values = p.today_values || {};
    entries.forEach((e) => { p.today_values[e.exercise_key] = e.value; });
  } else {
    result = await api.post(`/plans/${p.user_plan_id}/checkin`, { status: 'completed' });
  }

  p.already_logged_today = true;

  if (result) {
    p.current_streak = result.current_streak;
    p.longest_streak = Math.max(p.longest_streak, result.longest_streak ?? result.current_streak);
    p.is_completed = !!result.is_completed;
  }
}

listEl.addEventListener('change', async (e) => {
  const box = e.target.closest('[data-done]');
  if (!box || !box.checked) return;

  const card = box.closest('.pcard');
  const p = plans.find((x) => x.user_plan_id === card.dataset.id);
  const err = card.querySelector('[data-error]');

  err.textContent = '';
  box.disabled = true;

  try {
    await complete(p, p.plan_type === 'athletic' ? defaultEntries(p) : []);
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
  const card = e.target.closest('.pcard');
  if (!card) return;

  const p = plans.find((x) => x.user_plan_id === card.dataset.id);
  if (!p) return;

  const err = card.querySelector('[data-error]');

  // Tabs inside an opened plan.
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    selectTab(card, p, tab.dataset.tab);
    return;
  }

  // Tap the cover (or its button) to open / close the plan.
  if (e.target.closest('[data-cover]')) {
    toggleCard(card, p);
    return;
  }

  // Increase or decrease exercise numbers.
  const bump = e.target.closest('.stepper__btn');

  if (bump) {
    const row = bump.closest('.def-row');
    const input = row.querySelector('input');
    const step = Number(row.dataset.step) || 1;

    input.value = String(Math.max(0, Math.round(
      ((Number(input.value) || 0) + step * Number(bump.dataset.dir)) * 100
    ) / 100));

    return;
  }

  // Show or hide the custom number editor.
  const toggle = e.target.closest('[data-edit-toggle]');

  if (toggle) {
    const panel = card.querySelector('[data-edit]');
    const opening = panel.hidden;

    panel.hidden = !opening;
    card.classList.toggle('is-editing', opening);
    toggle.textContent = opening ? 'Cancel' : 'Numbers changed today?';

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
      plans = plans.filter((x) => x.user_plan_id !== p.user_plan_id);
      render();
    } catch (ex) {
      err.textContent = errorText(ex.message);
      exit.disabled = false;
    }

    return;
  }

  // Add / remove today's off day (athlete plans).
  const offTap = e.target.closest('[data-off]');

  if (offTap) {
    const turnOn = offTap.getAttribute('aria-pressed') !== 'true';

    offTap.disabled = true;
    err.textContent = '';

    try {
      const r = await api.post(`/plans/${p.user_plan_id}/off-day`, { off: turnOn });

      p.off_day = { ...p.off_day, is_off_today: r.is_off_day_today };
      replaceCard(p);
    } catch (ex) {
      offTap.disabled = false;
      err.textContent = OFF_ERRORS[ex.message] || errorText(ex.message);
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
      const r = await api.post(`/plans/${p.user_plan_id}/checkin`, { status: 'missed' });

      p.already_logged_today = true;
      p.current_streak = r.current_streak ?? 0;

      refreshAfterProgress(p);
    } catch (ex) {
      err.textContent = errorText(ex.message);
    }
  }
});

/* ----------------------------------------------------------------- init */

export async function initDashboard(user) {
  const now = new Date();

  document.getElementById('today-date').textContent =
    now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const hour = now.getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  document.getElementById('greeting').innerHTML =
    `${hello}, <em>${esc((user.display_name || '').split(' ')[0])}.</em>`;

  try {
    plans = (await api.get('/plans/mine')).filter((p) => !p.is_abandoned);

    render();
    plans.forEach(loadAnalytics);
  } catch (ex) {
    errEl.textContent = errorText(ex.message);
  }
}