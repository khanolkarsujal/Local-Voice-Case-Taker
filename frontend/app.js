const state = {
  sessionId: crypto.randomUUID ? crypto.randomUUID() : `session-${Date.now()}`,
  interviewActive: false,
  recorder: null,
  stream: null,
  analyser: null,
  monitorSource: null,
  audioContext: null,
  monitorFrame: null,
  speechDetected: false,
  silenceStartedAt: null,
  currentAudio: null,
  ws: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  start: $("start-button"),
  stop: $("stop-button"),
  mic: $("mic-button"),
  micStage: document.querySelector(".mic-stage"),
  stateLabel: $("state-label"),
  stateDetail: $("state-detail"),
  response: $("response-text"),
  list: $("conversation-list"),
  empty: $("empty-state"),
  form: $("text-form"),
  input: $("text-input"),
  clear: $("clear-button"),
  toast: $("toast"),
  pill: $("connection-pill"),
  connectionLabel: $("connection-label"),
  checked: $("last-checked"),
  whisper: $("whisper-status"),
  ollama: $("ollama-status"),
  piper: $("piper-status"),
  session: $("session-short"),
};

els.session.textContent = state.sessionId.slice(0, 6).toUpperCase();

function setState(next, detail) {
  const labels = {
    idle: "Ready when you are",
    listening: "Listening...",
    processing: "Processing...",
    speaking: "Speaking...",
    error: "Something needs attention",
    completed: "Interview paused",
  };
  els.stateLabel.textContent = labels[next] || labels.idle;
  els.stateLabel.className = `state-label ${next}`;
  els.stateDetail.textContent = detail || {
    idle: "Press start and speak in your normal voice.",
    listening: "Speak naturally. I’ll listen for a short pause.",
    processing: "Transcribing locally, then asking your local assistant.",
    speaking: "Playing the response through your computer speakers.",
    error: "Check the message below and try again.",
    completed: "Press Start Interview whenever you’re ready to continue.",
  }[next];
  els.micStage.classList.toggle("listening", next === "listening");
  els.mic.classList.toggle("active", next === "listening");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 4200);
}

function addMessage(role, text) {
  els.empty?.remove();
  const message = document.createElement("div");
  message.className = `message ${role}`;
  const label = document.createElement("div");
  label.className = "message-role";
  label.textContent = role === "user" ? "YOU" : "LOCAL AI";
  const body = document.createElement("p");
  body.textContent = text;
  message.append(label, body);
  els.list.appendChild(message);
  els.list.scrollTop = els.list.scrollHeight;
}

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${protocol}//${location.host}/ws?session_id=${encodeURIComponent(state.sessionId)}`);
  state.ws.onopen = () => {
    els.connectionLabel.textContent = "Local session connected";
    els.pill.classList.add("online");
  };
  state.ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "transcript") els.stateDetail.textContent = `"${payload.text}"`;
      if (payload.type === "response") els.response.textContent = payload.text;
      if (payload.type === "state" && payload.state === "processing") setState("processing");
    } catch {
      // Ignore malformed events; the REST response remains authoritative.
    }
  };
  state.ws.onclose = () => {
    els.connectionLabel.textContent = "Local session disconnected";
    els.pill.classList.remove("online");
    if (state.interviewActive) window.setTimeout(connectWebSocket, 1500);
  };
}

async function refreshHealth() {
  try {
    const response = await fetch("/health");
    const health = await response.json();
    updateServiceStatus(els.whisper, health.whisper);
    updateServiceStatus(els.ollama, health.ollama);
    updateServiceStatus(els.piper, health.piper);
    els.checked.textContent = `Checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    els.connectionLabel.textContent = health.status === "ok" ? "All local services online" : "Check local services";
    els.pill.classList.toggle("online", health.status === "ok");
    els.pill.classList.toggle("offline", health.status !== "ok");
  } catch {
    [els.whisper, els.ollama, els.piper].forEach((node) => updateServiceStatus(node, "offline"));
    els.connectionLabel.textContent = "Backend unavailable";
    els.pill.classList.add("offline");
  }
}

function updateServiceStatus(node, value) {
  node.textContent = value;
  node.className = `service-status ${value}`;
}

function chooseMimeType() {
  const choices = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  return choices.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

async function startInterview() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("This browser does not support microphone recording.");
    return;
  }
  state.interviewActive = true;
  els.start.disabled = true;
  els.stop.disabled = false;
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    startListening();
  } catch (error) {
    state.interviewActive = false;
    els.start.disabled = false;
    els.stop.disabled = true;
    setState("error", "Microphone permission was denied or the device is unavailable.");
    showToast(error.name === "NotAllowedError" ? "Please allow microphone access to start." : "Could not access the microphone.");
  }
}

function startListening() {
  if (!state.interviewActive || state.recorder?.state === "recording") return;
  if (!state.stream) return;
  const mimeType = chooseMimeType();
  state.recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  state.speechDetected = false;
  state.silenceStartedAt = null;
  state.recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  state.recorder.onstop = async () => {
    cancelMonitor();
    const blob = new Blob(chunks, { type: state.recorder.mimeType || "audio/webm" });
    if (blob.size > 0 && state.interviewActive) await sendAudio(blob);
  };
  state.recorder.start();
  setState("listening");
  setupLevelMonitor();
}

function setupLevelMonitor() {
  state.audioContext ||= new AudioContext();
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 512;
  state.monitorSource = state.audioContext.createMediaStreamSource(state.stream);
  state.monitorSource.connect(state.analyser);
  const data = new Uint8Array(state.analyser.fftSize);
  const check = (now) => {
    if (!state.recorder || state.recorder.state !== "recording") return;
    state.analyser.getByteTimeDomainData(data);
    const level = data.reduce((total, value) => total + Math.abs(value - 128), 0) / data.length / 128;
    if (level > 0.045) {
      state.speechDetected = true;
      state.silenceStartedAt = null;
    } else if (state.speechDetected) {
      state.silenceStartedAt ||= now;
      if (now - state.silenceStartedAt > 1400) {
        state.recorder.stop();
        return;
      }
    }
    state.monitorFrame = requestAnimationFrame(check);
  };
  state.monitorFrame = requestAnimationFrame(check);
}

function cancelMonitor() {
  if (state.monitorFrame) cancelAnimationFrame(state.monitorFrame);
  state.monitorSource?.disconnect();
  state.monitorSource = null;
  state.monitorFrame = null;
}

function stopRecording() {
  if (state.recorder?.state === "recording") state.recorder.stop();
}

async function stopInterview() {
  state.interviewActive = false;
  stopRecording();
  cancelMonitor();
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
  if (state.currentAudio) state.currentAudio.pause();
  els.start.disabled = false;
  els.stop.disabled = true;
  setState("completed");
}

function base64ToBlob(base64, mime) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

async function sendAudio(blob) {
  setState("processing");
  const data = new FormData();
  data.append("audio", blob, "recording.webm");
  try {
    const response = await fetch(`/api/turn?session_id=${encodeURIComponent(state.sessionId)}`, { method: "POST", body: data });
    await handleTurnResponse(response);
  } catch (error) {
    showRequestError(error);
  }
}

async function sendText(text) {
  setState("processing");
  try {
    const response = await fetch("/api/text-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, session_id: state.sessionId }),
    });
    await handleTurnResponse(response);
  } catch (error) {
    showRequestError(error);
  }
}

async function handleTurnResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Request failed (${response.status})`);
  addMessage("user", payload.transcript);
  addMessage("assistant", payload.response);
  els.response.textContent = payload.response;
  playAudio(payload.audio_base64, payload.audio_mime);
}

function playAudio(base64, mime) {
  state.currentAudio?.pause();
  state.currentAudio = new Audio(URL.createObjectURL(base64ToBlob(base64, mime)));
  setState("speaking");
  state.currentAudio.onended = () => {
    URL.revokeObjectURL(state.currentAudio.src);
    if (state.interviewActive) window.setTimeout(startListening, 350);
    else setState("completed");
  };
  state.currentAudio.onerror = () => {
    setState("error", "The WAV response was received but could not be played.");
    showToast("Could not play the local audio response.");
  };
  state.currentAudio.play().catch(() => {
    setState("error", "Click the page once, then try speaking again so the browser can play audio.");
    showToast("The browser blocked automatic audio playback.");
  });
}

function showRequestError(error) {
  setState("error");
  showToast(error.message || "The local voice loop failed.");
}

els.start.addEventListener("click", startInterview);
els.mic.addEventListener("click", () => (state.interviewActive ? stopInterview() : startInterview()));
els.stop.addEventListener("click", stopInterview);
els.clear.addEventListener("click", async () => {
  await fetch(`/api/conversation/clear?session_id=${encodeURIComponent(state.sessionId)}`, { method: "POST" });
  els.list.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.id = "empty-state";
  empty.innerHTML = '<div class="empty-line"></div><p>Your conversation will build here.</p><span>Nothing leaves your local machine.</span>';
  els.list.appendChild(empty);
  els.response.textContent = "Your assistant’s response will appear here after you speak.";
  setState("idle");
});
els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text) return;
  if (state.recorder?.state === "recording") stopRecording();
  els.input.value = "";
  await sendText(text);
});

connectWebSocket();
refreshHealth();
window.setInterval(refreshHealth, 10000);