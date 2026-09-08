const state = {
  sessionId: window.crypto?.randomUUID?.() || `session-${Date.now()}`,
  interviewActive: false,
  demoMode: false,
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
  session: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  start: $("start-button"),
  stop: $("stop-button"),
  mic: $("mic-button"),
  micStage: document.querySelector(".mic-stage"),
  stateLabel: $("state-label"),
  stateDetail: $("state-detail"),
  question: $("question-text"),
  response: $("response-text"),
  list: $("conversation-list"),
  empty: $("empty-state"),
  form: $("text-form"),
  input: $("text-input"),
  clear: $("clear-button"),
  demo: $("demo-button"),
  demoNext: $("demo-next-button"),
  toast: $("toast"),
  pill: $("connection-pill"),
  connectionLabel: $("connection-label"),
  checked: $("last-checked"),
  whisper: $("whisper-status"),
  ollama: $("ollama-status"),
  piper: $("piper-status"),
  session: $("session-short"),
  patientView: $("patient-view"),
  doctorView: $("doctor-view"),
  patientTab: $("patient-view-tab"),
  doctorTab: $("doctor-view-tab"),
  badge: $("demo-badge"),
  fields: $("case-fields"),
  reviewTranscript: $("review-transcript"),
  reviewState: $("review-state"),
  saveCase: $("save-case-button"),
  saveMessage: $("save-message"),
  backToPatient: $("back-to-patient-button"),
  newInterview: $("new-interview-button"),
  exportJson: $("export-json-button"),
  exportTxt: $("export-txt-button"),
};

const caseFields = [
  ["chief_complaint", "Patient Complaint", "text"],
  ["history_of_present_illness", "History of Present Illness", "text"],
  ["onset", "Onset", "text"],
  ["duration", "Duration", "text"],
  ["location", "Location", "text"],
  ["severity", "Severity", "text"],
  ["character", "Character / Quality", "text"],
  ["aggravating_factors", "Aggravating Factors", "list"],
  ["relieving_factors", "Relieving Factors", "list"],
  ["associated_symptoms", "Associated Symptoms", "list"],
  ["past_medical_history", "Past Medical History", "list"],
  ["medications", "Medications", "list"],
  ["allergies", "Allergies", "list"],
  ["family_history", "Family History", "list"],
  ["social_history", "Social History", "list"],
  ["other_information", "Other Relevant Information", "list"],
  ["information_not_obtained", "Information Not Obtained", "list"],
];

els.session.textContent = state.sessionId.slice(0, 6).toUpperCase();

function setState(next, detail) {
  const labels = {
    idle: "Ready when you are",
    listening: "Listening...",
    processing: "Processing...",
    speaking: "Speaking...",
    error: "Something needs attention",
    completed: "Interview complete",
  };
  els.stateLabel.textContent = labels[next] || labels.idle;
  els.stateLabel.className = `state-label ${next}`;
  els.stateDetail.textContent =
    detail ||
    {
      idle: "Your answers are kept on this computer for clinician review.",
      listening: "Speak naturally. I’ll listen for a short pause.",
      processing: "Transcribing locally and organizing the information.",
      speaking: "Playing the assistant’s next question.",
      error: "Check the message below and try again, or use the text fallback.",
      completed: "The case is ready for qualified clinician review.",
    }[next];
  els.micStage.classList.toggle("listening", next === "listening");
  els.mic.classList.toggle("active", next === "listening");
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 4600);
}

function friendlyAudioError(message) {
  if (!message) return "";
  if (message.toLowerCase().includes("piper") || message.toLowerCase().includes("reach")) {
    return "Voice service unavailable. Please check Piper. You can continue with text fallback.";
  }
  return message;
}

function renderTranscript(entries = []) {
  els.list.innerHTML = "";
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML =
      '<div class="empty-line"></div><p>The original conversation will build here.</p><span>Patient words are never replaced by a summary.</span>';
    els.list.appendChild(empty);
    return;
  }
  entries.forEach((entry) => {
    const message = document.createElement("div");
    message.className = `message ${entry.speaker}`;
    const label = document.createElement("div");
    label.className = "message-role";
    label.textContent = entry.speaker === "patient" ? "PATIENT" : "ASSISTANT";
    const body = document.createElement("p");
    body.textContent = entry.text;
    message.append(label, body);
    els.list.appendChild(message);
  });
  els.list.scrollTop = els.list.scrollHeight;
}

function updateFromPayload(payload) {
  state.session = {
    ...(state.session || {}),
    session_id: payload.session_id,
    status: payload.status,
    current_section: payload.current_section,
    case: payload.case,
    transcript: payload.conversation,
    is_demo: payload.is_demo,
  };
  els.session.textContent = payload.session_id.slice(0, 6).toUpperCase();
  renderTranscript(payload.conversation);
  els.response.textContent = payload.response;
  els.question.textContent = payload.response;
  if (payload.audio_error) showToast(friendlyAudioError(payload.audio_error));
  if (payload.interview_complete) {
    state.interviewActive = false;
    stopRecording();
    stopStream();
    els.start.disabled = false;
    els.stop.disabled = true;
    els.demoNext.hidden = true;
    els.doctorTab.disabled = false;
  }
}

function connectWebSocket() {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(
    `${protocol}//${location.host}/ws?session_id=${encodeURIComponent(state.sessionId)}`,
  );
  state.ws.onopen = () => {
    els.connectionLabel.textContent = "Local session connected";
  };
  state.ws.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "transcript") els.stateDetail.textContent = `"${payload.text}"`;
      if (payload.type === "response") {
        els.response.textContent = payload.text;
        els.question.textContent = payload.text;
      }
      if (payload.type === "state") setState(payload.state);
    } catch {
      // The REST response remains authoritative if an event is malformed.
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
    els.connectionLabel.textContent =
      health.status === "ok" ? "All local services online" : "Check local services";
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

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `Request failed (${response.status})`);
  return payload;
}

async function startInterview() {
  state.demoMode = false;
  els.badge.hidden = true;
  state.interviewActive = true;
  els.start.disabled = true;
  els.stop.disabled = false;
  const microphoneSupported = navigator.mediaDevices?.getUserMedia && window.MediaRecorder;
  if (microphoneSupported) {
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      showToast(
        error.name === "NotAllowedError"
          ? "Microphone permission is required for voice input. Text fallback remains available."
          : "Could not access the microphone. Text fallback remains available.",
      );
    }
  } else {
    showToast("This browser does not support microphone recording. Text fallback remains available.");
  }

  try {
    const payload = await api(`/api/interview/start?session_id=${encodeURIComponent(state.sessionId)}`, {
      method: "POST",
    });
    updateFromPayload(payload);
    await speakResponse(payload);
  } catch (error) {
    state.interviewActive = false;
    els.start.disabled = false;
    els.stop.disabled = true;
    setState("error");
    showToast(error.message);
  }
}

function startListening() {
  if (!state.interviewActive || state.demoMode || state.recorder?.state === "recording" || !state.stream) return;
  const mimeType = chooseMimeType();
  state.recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  state.speechDetected = false;
  state.silenceStartedAt = null;
  state.recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  state.recorder.onstop = async () => {
    cancelMonitor();
    const blob = new Blob(chunks, { type: state.recorder.mimeType || "audio/webm" });
    if (blob.size > 0 && state.interviewActive && !state.demoMode) await sendAudio(blob);
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
  cancelMonitor();
}

function stopStream() {
  state.stream?.getTracks().forEach((track) => track.stop());
  state.stream = null;
}

async function stopInterview() {
  state.interviewActive = false;
  stopRecording();
  stopStream();
  state.currentAudio?.pause();
  els.start.disabled = false;
  els.stop.disabled = true;
  setState("completed", "Interview paused. You can continue with text or start a new interview.");
}

function base64ToBlob(base64, mime) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function finishCompleted() {
  els.doctorTab.disabled = false;
  window.setTimeout(() => showDoctorView(), 700);
}

async function speakResponse(payload) {
  setState(payload.interview_complete ? "completed" : "speaking");
  if (payload.audio_base64) {
    state.currentAudio?.pause();
    const audio = new Audio(URL.createObjectURL(base64ToBlob(payload.audio_base64, payload.audio_mime)));
    state.currentAudio = audio;
    audio.onended = () => {
      URL.revokeObjectURL(audio.src);
      if (payload.interview_complete) finishCompleted();
      else if (state.interviewActive && state.stream) window.setTimeout(startListening, 350);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(audio.src);
      showToast("The WAV response could not be played. You can continue with text fallback.");
      if (state.interviewActive && state.stream && !payload.interview_complete) startListening();
    };
    try {
      await audio.play();
    } catch {
      showToast("The browser blocked automatic audio playback. Click the page, then try again.");
      if (state.interviewActive && state.stream && !payload.interview_complete) startListening();
    }
    return;
  }

  if (state.demoMode && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(payload.response);
    utterance.rate = 0.96;
    utterance.onend = () => {
      if (payload.interview_complete) finishCompleted();
    };
    window.speechSynthesis.speak(utterance);
  } else if (payload.interview_complete) {
    finishCompleted();
  } else if (state.interviewActive && state.stream) {
    startListening();
  }
}

async function sendAudio(blob) {
  setState("processing");
  const data = new FormData();
  data.append("audio", blob, "recording.webm");
  try {
    const payload = await api(`/api/interview/turn?session_id=${encodeURIComponent(state.sessionId)}`, {
      method: "POST",
      body: data,
    });
    updateFromPayload(payload);
    await speakResponse(payload);
  } catch (error) {
    setState("error");
    showToast(
      error.message.includes("Ollama")
        ? "AI service unavailable. Please check Ollama."
        : error.message.includes("speech")
          ? "No speech detected. Please try again."
          : error.message,
    );
  }
}

async function sendText(text) {
  state.interviewActive = true;
  setState("processing");
  try {
    const payload = await api("/api/interview/text-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, session_id: state.sessionId }),
    });
    updateFromPayload(payload);
    await speakResponse(payload);
  } catch (error) {
    setState("error");
    showToast(error.message.includes("Ollama") ? "AI service unavailable. Please check Ollama." : error.message);
  }
}

async function startDemo() {
  await stopInterview();
  state.demoMode = true;
  state.interviewActive = true;
  els.badge.hidden = false;
  els.start.disabled = true;
  els.stop.disabled = false;
  els.demoNext.hidden = false;
  try {
    const payload = await api(`/api/interview/demo/start?session_id=${encodeURIComponent(state.sessionId)}`, {
      method: "POST",
    });
    updateFromPayload(payload);
    await speakResponse(payload);
  } catch (error) {
    showToast(error.message);
    state.interviewActive = false;
    els.start.disabled = false;
  }
}

async function nextDemoStep() {
  if (!state.demoMode) return;
  try {
    const payload = await api(`/api/interview/demo/step?session_id=${encodeURIComponent(state.sessionId)}`, {
      method: "POST",
    });
    updateFromPayload(payload);
    await speakResponse(payload);
  } catch (error) {
    showToast(error.message);
  }
}

function renderCaseFields(caseData = {}) {
  els.fields.innerHTML = "";
  caseFields.forEach(([field, label, type]) => {
    const wrapper = document.createElement("label");
    wrapper.className = "case-field";
    const title = document.createElement("span");
    title.textContent = label;
    const input = document.createElement(type === "list" ? "textarea" : "input");
    input.dataset.field = field;
    input.value = type === "list" ? (caseData[field] || []).join("\n") : caseData[field] || "";
    input.placeholder = type === "list" ? "One item per line" : "Not recorded";
    if (type === "list") input.rows = Math.min(4, Math.max(2, (input.value.match(/\n/g) || []).length + 1));
    wrapper.append(title, input);
    els.fields.appendChild(wrapper);
  });
}

function renderReviewTranscript(entries = []) {
  els.reviewTranscript.innerHTML = "";
  entries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = `review-entry ${entry.speaker}`;
    const role = document.createElement("span");
    role.textContent = entry.speaker === "patient" ? "PATIENT" : "ASSISTANT";
    const text = document.createElement("p");
    text.textContent = entry.text;
    item.append(role, text);
    els.reviewTranscript.appendChild(item);
  });
}

async function loadSessionForReview() {
  try {
    const session = await api(`/api/interview/session?session_id=${encodeURIComponent(state.sessionId)}`);
    state.session = session;
    renderCaseFields(session.case);
    renderReviewTranscript(session.transcript);
    els.reviewState.textContent = session.status === "completed" ? "Interview complete" : "In progress";
  } catch (error) {
    showToast(error.message);
  }
}

function showPatientView() {
  els.patientView.hidden = false;
  els.doctorView.hidden = true;
  els.patientTab.classList.add("active");
  els.doctorTab.classList.remove("active");
}

async function showDoctorView() {
  await loadSessionForReview();
  els.patientView.hidden = true;
  els.doctorView.hidden = false;
  els.patientTab.classList.remove("active");
  els.doctorTab.classList.add("active");
}

async function saveCase() {
  if (!state.session) return;
  const updatedCase = {};
  els.fields.querySelectorAll("[data-field]").forEach((input) => {
    const field = input.dataset.field;
    if (input.tagName === "TEXTAREA") {
      updatedCase[field] = input.value.split("\n").map((item) => item.trim()).filter(Boolean);
    } else {
      updatedCase[field] = input.value.trim();
    }
  });
  try {
    const session = await api("/api/interview/case", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId, case: updatedCase }),
    });
    state.session = session;
    renderCaseFields(session.case);
    els.reviewState.textContent = "Corrections saved";
    els.saveMessage.textContent = "Saved in this local session.";
    window.setTimeout(() => (els.saveMessage.textContent = ""), 3000);
  } catch (error) {
    showToast(error.message);
  }
}

function downloadExport(path) {
  const link = document.createElement("a");
  link.href = `${path}?session_id=${encodeURIComponent(state.sessionId)}`;
  link.download = "";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function newInterview() {
  const oldSession = state.sessionId;
  await fetch(`/api/interview/clear?session_id=${encodeURIComponent(oldSession)}`, { method: "POST" });
  state.sessionId = window.crypto?.randomUUID?.() || `session-${Date.now()}`;
  state.session = null;
  state.demoMode = false;
  state.interviewActive = false;
  els.session.textContent = state.sessionId.slice(0, 6).toUpperCase();
  els.badge.hidden = true;
  els.demoNext.hidden = true;
  els.start.disabled = false;
  els.stop.disabled = true;
  els.doctorTab.disabled = true;
  renderTranscript([]);
  els.response.textContent = "Your assistant’s next question will appear here.";
  els.question.textContent = "When you are ready, start the interview and tell me what brings you in today.";
  showPatientView();
  connectWebSocket();
  setState("idle");
}

els.start.addEventListener("click", startInterview);
els.mic.addEventListener("click", () => (state.interviewActive ? stopInterview() : startInterview()));
els.stop.addEventListener("click", stopInterview);
els.demo.addEventListener("click", startDemo);
els.demoNext.addEventListener("click", nextDemoStep);
els.patientTab.addEventListener("click", showPatientView);
els.doctorTab.addEventListener("click", showDoctorView);
els.backToPatient.addEventListener("click", showPatientView);
els.newInterview.addEventListener("click", newInterview);
els.saveCase.addEventListener("click", saveCase);
els.exportJson.addEventListener("click", () => downloadExport("/api/interview/export.json"));
els.exportTxt.addEventListener("click", () => downloadExport("/api/interview/export.txt"));
els.clear.addEventListener("click", async () => {
  await fetch(`/api/interview/clear?session_id=${encodeURIComponent(state.sessionId)}`, { method: "POST" });
  state.session = null;
  state.interviewActive = false;
  state.demoMode = false;
  els.demoNext.hidden = true;
  els.start.disabled = false;
  els.stop.disabled = true;
  renderTranscript([]);
  els.response.textContent = "Your assistant’s next question will appear here.";
  els.question.textContent = "When you are ready, start the interview and tell me what brings you in today.";
  setState("idle");
});
els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text || state.demoMode) return;
  if (state.recorder?.state === "recording") stopRecording();
  els.input.value = "";
  await sendText(text);
});

connectWebSocket();
refreshHealth();
window.setInterval(refreshHealth, 10000);