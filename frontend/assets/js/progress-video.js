import { api } from './modules/api-client.js';

let mediaStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedBlob = null;
let countdownTimer = null;

function setPanelState(state) {
  document.getElementById('video-recorder-idle').style.display = state === 'idle' ? '' : 'none';
  document.getElementById('video-recorder-active').style.display = state === 'active' ? '' : 'none';
  document.getElementById('video-recorder-review').style.display = state === 'review' ? '' : 'none';
}

function stopStream() {
  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }
}

async function startRecording() {
  const errorEl = document.getElementById('video-error');
  errorEl.textContent = '';

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    errorEl.textContent = "Couldn't access your camera — check your browser's camera permission for this site.";
    return;
  }

  const preview = document.getElementById('video-preview');
  preview.srcObject = mediaStream;
  setPanelState('active');

  recordedChunks = [];
  const mimeType = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : 'video/mp4';
  mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    recordedBlob = new Blob(recordedChunks, { type: mimeType });
    stopStream();

    const reviewVideo = document.getElementById('video-review');
    reviewVideo.src = URL.createObjectURL(recordedBlob);
    setPanelState('review');
  };

  mediaRecorder.start();

  let secondsLeft = 10;
  const countdownEl = document.getElementById('recording-countdown');
  countdownEl.textContent = `Recording — ${secondsLeft}s`;

  countdownTimer = setInterval(() => {
    secondsLeft -= 1;
    countdownEl.textContent = `Recording — ${secondsLeft}s`;
    if (secondsLeft <= 0) {
      clearInterval(countdownTimer);
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    }
  }, 1000);
}

function discardRecording() {
  recordedBlob = null;
  recordedChunks = [];
  setPanelState('idle');
}

async function saveRecording(planId, onSaved) {
  const errorEl = document.getElementById('video-error');
  const saveBtn = document.getElementById('save-recording-btn');
  if (!recordedBlob) return;

  saveBtn.disabled = true;
  errorEl.textContent = '';

  const formData = new FormData();
  const ext = recordedBlob.type.includes('mp4') ? 'mp4' : 'webm';
  formData.append('video', recordedBlob, `checkin.${ext}`);

  try {
    const res = await fetch(`${api.baseUrl}/plans/${planId}/videos`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-Quiter-Client': 'web' },
      body: formData,
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || 'upload_failed');

    discardRecording();
    if (onSaved) await onSaved();
  } catch (err) {
    errorEl.textContent = `Couldn't save your video: ${err.message}`;
  } finally {
    saveBtn.disabled = false;
  }
}

function renderGallery(videos) {
  const gallery = document.getElementById('video-gallery');
  gallery.innerHTML = '';

  if (videos.length === 0) {
    gallery.innerHTML = '<p class="custom-plan__hint">No check-in videos yet — record your first one above.</p>';
    return;
  }

  videos.forEach((v) => {
    const item = document.createElement('div');
    item.className = 'progress-video__gallery-item';
    item.innerHTML = `
      <video src="${v.video_url}" controls playsinline></video>
      <p>Day ${v.day_number}</p>
    `;
    gallery.appendChild(item);
  });
}

export async function initProgressVideo(planId, currentFrequency) {
  const freqSelect = document.getElementById('video-frequency-select');
  freqSelect.value = currentFrequency || '';

  freqSelect.onchange = async () => {
    try {
      await api.patch(`/plans/${planId}/video-frequency`, { frequency: freqSelect.value || null });
    } catch (err) {
      alert(`Couldn't save your reminder preference: ${err.message}`);
    }
  };

  const refreshGallery = async () => {
    try {
      const videos = await api.get(`/plans/${planId}/videos`);
      renderGallery(videos);
    } catch (err) {
      document.getElementById('video-gallery').textContent = "Couldn't load your videos.";
    }
  };

  document.getElementById('start-recording-btn').onclick = startRecording;
  document.getElementById('discard-recording-btn').onclick = discardRecording;
  document.getElementById('save-recording-btn').onclick = () => saveRecording(planId, refreshGallery);

  await refreshGallery();
}