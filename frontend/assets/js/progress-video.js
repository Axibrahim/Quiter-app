/**
 * Optional 10-second video check-ins.
 *  - Frequency Off hides the recorder completely (existing clips still show).
 *  - Recording can be cancelled or stopped early at any time.
 */
import { api, errorText } from './modules/api-client.js';

const $ = (id) => document.getElementById(id);
let stream = null, recorder = null, chunks = [], blob = null, timer = null, cancelled = false;

function show(state) {
  $('rec-idle').hidden = state !== 'idle';
  $('rec-active').hidden = state !== 'active';
  $('rec-review').hidden = state !== 'review';
}
function stopStream() { stream?.getTracks().forEach((t) => t.stop()); stream = null; }
function clearTimer() { clearInterval(timer); timer = null; }

async function start() {
  $('video-error').textContent = '';
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    $('video-error').textContent = "This browser can't record video. Try Chrome, Edge, Firefox or Safari 14.1+.";
    return;
  }
  try { stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); }
  catch { $('video-error').textContent = "Couldn't reach your camera — allow camera access for this site and try again."; return; }

  $('rec-preview').srcObject = stream;
  show('active');
  chunks = []; cancelled = false;
  const mime = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
  recorder = new MediaRecorder(stream, { mimeType: mime });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    clearTimer(); stopStream();
    if (cancelled) { show('idle'); return; }
    blob = new Blob(chunks, { type: mime });
    $('rec-review-video').src = URL.createObjectURL(blob);
    show('review');
  };
  recorder.start();

  let left = 10;
  $('rec-count').textContent = `Recording — ${left}s`;
  timer = setInterval(() => {
    left -= 1;
    $('rec-count').textContent = `Recording — ${Math.max(left, 0)}s`;
    if (left <= 0 && recorder.state !== 'inactive') recorder.stop();
  }, 1000);
}

function cancelRecording() { cancelled = true; if (recorder && recorder.state !== 'inactive') recorder.stop(); else { stopStream(); clearTimer(); show('idle'); } }
function discard() { blob = null; chunks = []; show('idle'); }

async function save(planId, refresh) {
  if (!blob) return;
  const btn = $('rec-save');
  btn.disabled = true; $('video-error').textContent = '';
  const form = new FormData();
  form.append('video', blob, `checkin.${blob.type.includes('mp4') ? 'mp4' : 'webm'}`);
  try { await api.upload(`/plans/${planId}/videos`, form); discard(); await refresh(); }
  catch (ex) { $('video-error').textContent = `Couldn't save your video. ${errorText(ex.message)}`; }
  finally { btn.disabled = false; }
}

function renderGallery(videos, enabled) {
  const g = $('gallery');
  g.innerHTML = videos.map((v) => `<div class="gallery__item"><video src="${encodeURI(v.video_url)}" controls playsinline preload="metadata"></video><p>Day ${Number(v.day_number)}</p></div>`).join('');
  $('video-state').textContent = enabled
    ? (videos.length ? 'Your check-ins so far:' : 'No clips yet — record your first 10 seconds whenever you feel like it.')
    : (videos.length ? 'Video check-ins are off. Your saved clips are below.' : 'Off. Turn on weekly or monthly if you’d like to record short progress clips. Totally optional.');
}

export function initVideoCheckins(planId, frequency) {
  let freq = frequency || '';
  let videos = [];
  const radios = document.querySelectorAll('input[name=vfreq]');
  const apply = () => {
    radios.forEach((r) => { r.checked = r.value === freq; });
    $('recorder').hidden = !freq;
    if (!freq) cancelRecording();
    renderGallery(videos, !!freq);
  };
  const refresh = async () => {
    try { videos = await api.get(`/plans/${planId}/videos`); } catch { videos = []; $('video-error').textContent = "Couldn't load your videos."; }
    apply();
  };

  radios.forEach((r) => r.addEventListener('change', async () => {
    const prev = freq;
    freq = r.value; apply();
    try { await api.patch(`/plans/${planId}/video-frequency`, { frequency: freq || null }); }
    catch (ex) { freq = prev; apply(); $('video-error').textContent = errorText(ex.message); }
  }));

  $('rec-start').onclick = start;
  $('rec-stop').onclick = () => recorder && recorder.state !== 'inactive' && recorder.stop();
  $('rec-cancel').onclick = cancelRecording;
  $('rec-discard').onclick = discard;
  $('rec-save').onclick = () => save(planId, refresh);
  show('idle');
  refresh();
}