/**
 * The settings shared by the Personal and Athlete plan forms:
 * pace, coaching style, reminders, and the OPTIONAL video check-ins.
 * Both pages call mountCommonFields() so this markup/logic exists once.
 */
export const PLAN_ERRORS = {
  invalid_goal_text: 'Describe your goal in 3–120 characters.',
  invalid_length_days: 'Pick a plan length between 3 and 365 days.',
  invalid_identity_statement: 'Keep "who you are becoming" under 160 characters.',
  invalid_reminder_times: 'Reminder times look invalid.',
  invalid_timezone: "We couldn't read your timezone.",
  invalid_video_frequency: 'Pick Off, Weekly or Monthly for video check-ins.',
  invalid_sport: 'Pick a sport first.',
  invalid_progression_goal: 'Describe your target in 3–200 characters.',
  invalid_tracked_exercises: 'Pick 1–8 exercises (custom names need 2–60 characters).',
  invalid_default_numbers: 'Set a daily number above 0 for every exercise.',
};

const STYLES = [
  ['gentle', 'Gentle', 'Kind nudges. Small steps. No pressure.'],
  ['focused', 'Focused', 'Direct and brisk. High standards.'],
  ['reflective', 'Reflective', 'Calm. Connects each day to who you are becoming.'],
];
const DEFAULT_TIMES = ['08:00', '13:00', '20:00'];

const html = `
<section class="group liquid-glass liquid-glass--panel">
  <p class="group__label">Pace</p>
  <div class="range-head"><span>Plan length</span><output id="len-out">30 days</output></div>
  <input id="len" type="range" min="7" max="180" step="1" value="30" aria-label="Plan length in days">
  <div class="range-labels"><span>1 week</span><span>6 months</span></div>
  <div class="presets" id="presets">
    <button type="button" data-d="14">14 days</button><button type="button" data-d="30">30 days</button>
    <button type="button" data-d="60">60 days</button><button type="button" data-d="90">90 days</button>
  </div>
</section>

<section class="group liquid-glass liquid-glass--panel">
  <p class="group__label">Your coach</p>
  <div class="field">
    <label for="identity">Who are you becoming? <span class="optional">Optional</span></label>
    <input id="identity" type="text" maxlength="160" placeholder="I'm someone who shows up, even on hard days.">
  </div>
  <div class="style-opts" role="radiogroup" aria-label="Coaching style">
    ${STYLES.map(([v, t, d], i) => `<label class="style-opt"><input type="radio" name="style" value="${v}" ${i === 0 ? 'checked' : ''}><span><strong>${t}</strong><small>${d}</small></span></label>`).join('')}
  </div>
</section>

<section class="group liquid-glass liquid-glass--panel">
  <p class="group__label">Email check-ins <span class="optional">Up to 3 a day</span></p>
  <p class="field__hint" style="margin-bottom:1rem;max-width:none">Your coach emails you a personal message with a one-tap “Yes, I'm on track” button. Pick when.</p>
  ${DEFAULT_TIMES.map((t, i) => `<div class="reminder-row" data-row><label class="q-check"><input type="checkbox" ${i === 0 ? 'checked' : ''} data-on><span class="q-check__box"></span><span class="q-check__label">${['Morning', 'Afternoon', 'Evening'][i]}</span></label><input type="time" value="${t}" data-time aria-label="Reminder time"></div>`).join('')}
  <p class="field__hint" id="tz-hint"></p>
</section>

<section class="group liquid-glass liquid-glass--panel">
  <p class="group__label">10-second video check-ins <span class="optional">Optional</span></p>
  <div class="video-opt">
    <div class="seg" role="radiogroup" aria-label="Video check-in frequency">
      <label><input type="radio" name="video" value="" checked><span>Off</span></label>
      <label><input type="radio" name="video" value="weekly"><span>Weekly</span></label>
      <label><input type="radio" name="video" value="monthly"><span>Monthly</span></label>
    </div>
    <p class="field__hint" style="max-width:none">Record a short clip now and then to see your own progress. It's private to you, and you can turn it off any time — skipping it changes nothing else.</p>
  </div>
</section>`;

export function mountCommonFields(host, { pace = true } = {}) {
  host.innerHTML = html;
  if (!pace) host.querySelector('#len').closest('section').remove();   // catalog plans keep their own length
  const $ = (s) => host.querySelector(s);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  $('#tz-hint').textContent = `Times use your timezone: ${tz}`;

  const len = $('#len'), out = $('#len-out');
  if (len) {
    const syncLen = () => {
      out.textContent = `${len.value} days`;
      const pct = ((len.value - len.min) / (len.max - len.min)) * 100;
      len.style.setProperty('--range-progress', `${pct}%`);
      host.querySelectorAll('#presets button').forEach((b) => b.classList.toggle('is-active', b.dataset.d === len.value));
    };
    len.addEventListener('input', syncLen);
    $('#presets').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { len.value = b.dataset.d; syncLen(); } });
    syncLen();
  }

  const rows = [...host.querySelectorAll('[data-row]')];
  const syncRow = (r) => r.classList.toggle('is-selected', r.querySelector('[data-on]').checked);
  rows.forEach((r) => { syncRow(r); r.querySelector('[data-on]').addEventListener('change', () => syncRow(r)); });

  return {
    read() {
      const times = rows.filter((r) => r.querySelector('[data-on]').checked).map((r) => r.querySelector('[data-time]').value).filter(Boolean);
      return {
        ...(len ? { length_days: Number(len.value) } : {}),
        identity_statement: $('#identity').value.trim(),
        support_style: host.querySelector('input[name=style]:checked').value,
        reminder_times: [...new Set(times)],
        reminder_timezone: tz,
        video_checkin_frequency: host.querySelector('input[name=video]:checked').value || null,
      };
    },
  };
}