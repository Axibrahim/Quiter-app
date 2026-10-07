import { api, errorText } from './modules/api-client.js';
import { initVideoCheckins } from './progress-video.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS_COLOR = { completed: 'var(--accent-teal)', partial: 'var(--accent-gold)', missed: 'var(--accent-ember)', relapsed: 'var(--accent-ember)', none: 'rgba(255,255,255,.12)' };

function sparkline(points) {
  if (points.length < 2) return '<p class="field__hint">Log a few more days to see a trend.</p>';
  const vals = points.map((p) => p.value), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const coords = points.map((p, i) => [(i / (points.length - 1)) * 200, 52 - ((p.value - min) / span) * 48]);
  const last = coords[coords.length - 1];
  return `<svg class="spark" viewBox="0 0 200 56" preserveAspectRatio="none" role="img" aria-label="trend"><polyline points="${coords.map((c) => c.join(',')).join(' ')}"/><circle cx="${last[0]}" cy="${last[1]}" r="3.5"/></svg>`;
}

function renderAnalytics(a, athletic) {
  if (a.diagnosis?.length) {
    $('coach-panel').hidden = false;
    $('diagnosis').innerHTML = a.diagnosis.map((n) => `<li class="${n.level === 'good' ? 'is-good' : n.level === 'warn' ? 'is-warn' : ''}">${esc(n.text)}</li>`).join('');
  }
  if (a.weekdays?.some((w) => w.possible >= 1)) {
    $('weekday-panel').hidden = false;
    $('weekdays').innerHTML = a.weekdays.map((w) => `<div><i style="height:${Math.max(3, w.pct)}%" title="${esc(w.weekday)} ${w.pct}%"></i><span>${esc(w.weekday.slice(0, 3))}</span></div>`).join('');
  }
  if (athletic && a.exercises?.length) {
    $('ex-panel').hidden = false;
    $('ex-cards').innerHTML = a.exercises.map((e) => `
      <div class="ex-card"><p class="ex-card__name">${esc(e.label)}</p>
        <div class="ex-card__meta"><span>Latest ${e.latest ?? '–'} ${esc(e.unit)}</span><span>Best ${e.best ?? '–'}</span></div>
        ${sparkline(e.points)}</div>`).join('');
  }
}

export async function initProgress() {
  const err = $('p-error');
  try {
    let planId = new URLSearchParams(location.search).get('plan');
    if (!planId) {
      const mine = (await api.get('/plans/mine')).filter((p) => !p.is_abandoned);
      if (!mine.length) { location.replace('dashboard.html'); return; }
      planId = mine[0].user_plan_id;
    }

    const p = await api.get(`/plans/${planId}/progress`);
    $('p-kind').textContent = p.plan_type === 'athletic'
      ? ['Athlete plan', p.athletic?.sport_label, p.athletic?.phase_label?.split('—')[0].trim()].filter(Boolean).join(' · ')
      : 'Personal plan';
    const cleaned = sportLabel && p.goal_text.startsWith(`${sportLabel} — `) ? p.goal_text.slice(sportLabel.length + 3) : p.goal_text;
    $('p-title').textContent = p.plan_type !== 'catalog' && p.title && p.title !== p.goal_text ? p.title : cleaned;
    $('s-day').textContent = `${p.day_number}/${p.total_days}`;
    $('s-streak').textContent = p.current_streak;
    $('s-best').textContent = p.longest_streak;

    if (!p.is_completed && p.days_since_checkin >= 7) {
      $('quit-warning').hidden = false;
      $('quit-warning-text').textContent = `No check-in for ${p.days_since_checkin} days. Plans that go quiet for 15 days are closed automatically — ${p.days_until_auto_quit} day${p.days_until_auto_quit === 1 ? '' : 's'} left. Check in today to keep it going.`;
    }

    $('heatmap').innerHTML = p.heatmap.map((c) => `<div class="heatmap__cell" style="background:${STATUS_COLOR[c.status] || STATUS_COLOR.none}" title="${esc(c.date)}: ${esc(c.status)}"></div>`).join('');

    const exit = $('exit-btn');
    exit.hidden = p.is_completed || p.is_abandoned;
    exit.addEventListener('click', async () => {
      if (!exit.classList.contains('is-confirming')) {
      exit.classList.add('is-confirming');
      exit.textContent = 'Tap again to exit';
      setTimeout(() => {
        exit.classList.remove('is-confirming');
        exit.textContent = 'Exit this plan';
      }, 4000);
      return;
    }

    exit.disabled = true;

    try {
      await api.post(`/plans/${planId}/abandon`);
      location.href = 'dashboard.html';
    } catch (ex) {
      err.textContent = errorText(ex.message);
      exit.disabled = false;
      exit.classList.remove('is-confirming');
      exit.textContent = 'Exit this plan';
    }
  });

    initVideoCheckins(planId, p.video_checkin_frequency);
    api.get(`/plans/${planId}/analytics`).then((a) => renderAnalytics(a, !!p.athletic)).catch(() => {});
  } catch (ex) {
    err.textContent = errorText(ex.message);
  }
}