/**
 * Plans page: lists the ready-made plans admins create (GET /plans/templates)
 * and starts one (POST /plans/adopt) after a short setup modal.
 */
import { api, errorText } from './modules/api-client.js';
import { openAuthModal } from './modules/auth-modal.js';
import { mountCommonFields, PLAN_ERRORS } from './modules/plan-form.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let templates = [];
let modal = null;
let common = null;
let selected = null;

function card(t) {
  const hasPhoto = /^https?:\/\//i.test(t.photo_url || '');
  const photo = hasPhoto ? `<div class="tpl__photo" style="background-image:url('${encodeURI(t.photo_url)}')"></div>` : '';
  return `<article class="tpl liquid-glass liquid-glass--panel" data-reveal>
    ${photo}
    <div class="tpl__body">
      <div class="tpl__meta"><span class="badge">${t.length_days} days</span><span class="badge">${esc(t.category || 'Plan')}</span></div>
      <h3 class="tpl__title">${esc(t.title)}</h3>
      <p class="tpl__desc">${esc(t.tagline || t.description || t.identity_statement || '')}</p>
      <button class="btn btn--solid" type="button" data-start="${esc(t.id)}">${esc(t.cta_text || 'Start this plan')}</button>
    </div></article>`;
}

function buildModal() {
  document.body.insertAdjacentHTML('beforeend', `
  <div class="modal-overlay" id="tpl-overlay" role="dialog" aria-modal="true" aria-labelledby="tpl-title">
    <div class="modal modal--wide liquid-glass liquid-glass--panel">
      <button class="icon-btn modal__close" type="button" data-close aria-label="Close">✕</button>
      <p class="eyebrow" id="tpl-meta"></p>
      <h2 class="h3" id="tpl-title" style="margin:.3rem 0 .4rem"></h2>
      <p id="tpl-desc" style="margin-bottom:1.2rem"></p>
      <div id="tpl-common"></div>
      <p class="error" id="tpl-error" role="alert"></p>
      <button class="btn btn--solid modal__submit" type="button" id="tpl-go">Start this plan</button>
    </div>
  </div>`);
  modal = document.getElementById('tpl-overlay');
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) modal.classList.remove('is-open'); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') modal.classList.remove('is-open'); });
  document.getElementById('tpl-go').addEventListener('click', start);
}

function openSetup(t) {
  selected = t;
  document.getElementById('tpl-meta').textContent = `${t.length_days} days${t.category ? ' · ' + t.category : ''}`;
  document.getElementById('tpl-title').textContent = t.title;
  document.getElementById('tpl-desc').textContent = t.description || t.identity_statement || '';
  document.getElementById('tpl-error').textContent = '';
  common = mountCommonFields(document.getElementById('tpl-common'), { pace: false });
  modal.classList.add('is-open');
}

async function start() {
  const btn = document.getElementById('tpl-go');
  const err = document.getElementById('tpl-error');
  err.textContent = '';
  btn.disabled = true; btn.textContent = 'Starting…';
  try {
    await api.post('/plans/adopt', { template_id: selected.id, ...common.read() });
    window.location.href = 'dashboard.html';
  } catch (ex) {
    if (ex.message === 'plan_already_active') { window.location.href = 'dashboard.html'; return; }
    err.textContent = PLAN_ERRORS[ex.message] || errorText(ex.message);
    btn.disabled = false; btn.textContent = 'Start this plan';
  }
}

export async function initPlans(user) {
  let list = [];
  try { list = await api.get('/plans/templates'); } catch { return; }   // optional section: fail quietly
  templates = list;
  if (!templates.length) return;

  document.getElementById('tpl-grid').innerHTML = templates.map(card).join('');
  document.getElementById('ready-made').hidden = false;
  buildModal();

  document.getElementById('tpl-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-start]');
    if (!b) return;
    const t = templates.find((x) => x.id === b.dataset.start);
    if (!user) { openAuthModal('signup', 'plans.html'); return; }
    openSetup(t);
  });
  // Newly rendered cards need the reveal animation too.
  document.querySelectorAll('#tpl-grid [data-reveal]').forEach((el) => el.classList.add('is-visible'));
  const m = location.hash.match(/^#start=([0-9a-f-]{36})$/i);
  const wanted = m && templates.find((x) => x.id === m[1]);
  if (wanted) {
    if (!user) openAuthModal('signup', 'plans.html' + location.hash);
    else openSetup(wanted);
  }
}