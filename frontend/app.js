const state = {
  sessionId: window.crypto?.randomUUID?.() || `session-${Date.now()}`,
  language: "en",
  consentGiven: false,
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
  lastPayload: null,
  answerReviewPayload: null,
  editingTranscriptIndex: null,
  sessionStartedAt: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  welcome: $("welcome-view"),
  consent: $("consent-modal"),
  patient: $("patient-view"),
  completion: $("completion-view"),
  doctor: $("doctor-view"),
  brandHome: $("brand-home-button"),
  welcomeStart: $("welcome-start-button"),
  welcomeDemo: $("welcome-demo-button"),
  privacyConsent: $("privacy-consent-link"),
  consentAgree: $("consent-agree-button"),
  consentCancel: $("consent-cancel-button"),
  consentCancelAction: $("consent-cancel-action"),
  patientHome: $("patient-home-button"),
  languageOptions: [...document.querySelectorAll(".language-option")],
  languageHelp: $("language-help"),
  interviewLanguage: $("interview-language-label"),
  completionAnswers: $("completion-answers"),
  completionDuration: $("completion-duration"),
  completionLanguage: $("completion-language"),
  viewCase: $("view-case-button"),
  start: $("start-button"),
  stop: $("stop-button"),
  mic: $("mic-button"),
  micStage: document.querySelector(".mic-stage"),
  stateLabel: $("state-label"),
  stateDetail: $("state-detail"),
  question: $("question-text"),
  response: $("response-text"),
  progressCount: $("progress-count"),
  progressFill: $("progress-fill"),
  list: $("conversation-list"),
  form: $("text-form"),
  input: $("text-input"),
  clear: $("clear-button"),
  demoNext: $("demo-next-button"),
  repeat: $("repeat-button"),
  skip: $("skip-button"),
  answerReview: $("answer-review"),
  answerReviewText: $("answer-review-text"),
  confirmAnswer: $("confirm-answer-button"),
  retryAnswer: $("retry-answer-button"),
  editAnswer: $("edit-answer-button"),
  toast: $("toast"),
  pill: $("connection-pill"),
  connectionLabel: $("connection-label"),
  checked: $("last-checked"),
  whisper: $("whisper-status"),
  ollama: $("ollama-status"),
  piper: $("piper-status"),
  session: $("session-short"),
  demoBadge: $("demo-badge"),
  backToPatient: $("back-to-patient-button"),
  newInterview: $("new-interview-button"),
  printCase: $("print-case-button"),
  patientAvatar: $("patient-avatar"),
  patientName: $("patient-name"),
  patientDemographics: $("patient-demographics"),
  caseStatus: $("case-status"),
  caseId: $("case-id-label"),
  dashboardStatus: $("dashboard-interview-status"),
  dashboardDate: $("dashboard-interview-date"),
  dashboardLanguage: $("dashboard-language"),
  dashboardReview: $("dashboard-review-status"),
  dashboardReviewedAt: $("dashboard-reviewed-at"),
  markReviewed: $("mark-reviewed-button"),
  reopenReview: $("reopen-review-button"),
  fields: $("case-fields"),
  reviewTranscript: $("review-transcript"),
  reviewState: $("review-state"),
  saveCase: $("save-case-button"),
  saveMessage: $("save-message"),
  notes: $("doctor-notes"),
  saveNotes: $("save-notes-button"),
  notesMessage: $("notes-save-message"),
  exportJson: $("export-json-button"),
  exportTxt: $("export-txt-button"),
};

const languageNames = { en: "English", hi: "Hindi", mr: "Marathi" };
const caseFields = [
  ["patient_name", "Patient name", "text"],
  ["age", "Age", "number"],
  ["gender", "Gender", "text"],
  ["chief_complaint", "Chief complaint", "text"],
  ["history_of_present_illness", "History of present concern", "text"],
  ["onset", "Onset", "text"],
  ["duration", "Duration", "text"],
  ["location", "Location", "text"],
  ["severity", "Severity", "text"],
  ["character", "Character / quality", "text"],
  ["aggravating_factors", "Aggravating factors", "list"],
  ["relieving_factors", "Relieving factors", "list"],
  ["associated_symptoms", "Associated symptoms", "list"],
  ["past_medical_history", "Existing conditions", "list"],
  ["medications", "Medications", "list"],
  ["allergies", "Allergies", "list"],
  ["family_history", "Family history", "list"],
  ["social_history", "Personal and social history", "list"],
  ["other_information", "Other relevant information", "list"],
  ["information_not_obtained", "Information not obtained", "list"],
];

els.session.textContent = state.sessionId.slice(0, 6).toUpperCase();

function languageLabel() {
  return languageNames[state.language] || languageNames.en;
}

function setScreen(screen) {
  els.welcome.hidden = screen !== "welcome";
  els.patient.hidden = screen !== "patient";
  els.completion.hidden = screen !== "completion";
  els.doctor.hidden = screen !== "doctor";
}

function setState(next, detail) {
  const labels = {
    idle: "Ready when you are",
    listening: "Listening...",
    processing: "Understanding your response...",
    speaking: "VoiceCase AI is speaking...",
    error: "We couldn't hear that clearly",
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
      speaking: "Listen to the next question, then answer when you are ready.",
      error: "Try again, type your answer, or continue without this question.",
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

function friendlyError(error) {
  const message = error?.message || String(error);
  const lower = message.toLowerCase();
  if (lower.includes("ollama") || lower.includes("ai service")) return "The local AI service is unavailable. Please check Ollama or continue in Demo Mode.";
  if (lower.includes("piper") || lower.includes("voice service")) return "Voice playback is unavailable. You can continue with the text fallback.";
  if (lower.includes("whisper") || lower.includes("transcription")) return "Local transcription is unavailable. Please try again or type your answer.";
  if (lower.includes("failed to fetch")) return "The local app is unavailable. Please check that FastAPI is running.";
  return "Something went wrong. Please try again.";
}

function updateLanguage(language) {
  state.language = language;
  els.languageOptions.forEach((button) => button.classList.toggle("active", button.dataset.language === language));
  els.interviewLanguage.textContent = languageLabel();
  els.completionLanguage.textContent = languageLabel();
  els.dashboardLanguage.textContent = languageLabel();
  els.languageHelp.textContent =
    language === "en"
      ? "Choose the language you prefer for this interview."
      : "Language preference saved. VoiceCase AI will use this setting where local language support is available.";
}

function openConsent() {
  els.consent.hidden = false;
  els.consentAgree.focus();
}

function closeConsent() {
  els.consent.hidden = true;
}

function renderTranscript(entries = []) {
  els.list.innerHTML = "";
  if (!entries.length) {
    els.list.innerHTML =
      '<div class="empty-state"><div class="empty-line"></div><p>Your conversation will appear here.</p><span>Patient words remain separate from the structured case.</span></div>';
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

function updateProgress(payload) {
  const answered = (payload.conversation || []).filter((entry) => entry.speaker === "patient").length;
  const question = Math.min(16, Math.max(1, answered + 1));
  els.progressCount.textContent = payload.interview_complete ? "Interview complete" : `Question ${question} of 16`;
  els.progressFill.style.width = `${payload.interview_complete ? 100 : Math.max(7, Math.round((question / 16) * 100))}%`;
}

function updateFromPayload(payload) {
  state.lastPayload = payload;
  state.session = {
    ...(state.session || {}),
    session_id: payload.session_id,
    status: payload.status,
    current_section: payload.current_section,
    case: payload.case,
    transcript: payload.conversation,
    is_demo: payload.is_demo,
    language: state.language,
  };
  els.session.textContent = payload.session_id.slice(0, 6).toUpperCase();
  renderTranscript(payload.conversation);
  updateProgress(payload);
  els.response.textContent = payload.response;
  els.question.textContent = payload.response;
  if (payload.audio_error) showToast("Voice playback is unavailable. You can continue with text fallback.");
  if (payload.interview_complete) {
    state.interviewActive = false;
    stopRecording();
    stopStream();
    els.start.disabled = false;
    els.stop.disabled = true;
    els.demoNext.hidden = true;
  }
}

function connectWebSocket() {
  state.ws?.close();
  const connectedSession = state.sessionId;
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${protocol}//${location.host}/ws?session_id=${encodeURIComponent(connectedSession)}`);
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
      if (payload.type === "state" && !els.answerReview.hidden) return;
      if (payload.type === "state") setState(payload.state);
    } catch {
      // REST responses remain authoritative if an event is malformed.
    }
  };
  state.ws.onclose = () => {
    if (connectedSession !== state.sessionId) return;
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
  node.textContent = value === "not_loaded" ? "not loaded" : value;
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

async function setSessionLanguage() {
  if (!state.session) return;
  try {
    await api("/api/interview/session", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId, language: state.language }),
    });
  } catch {
    // The start route already stores the preference; this is a best-effort sync for an active session.
  }
}

async function startInterview() {
  closeConsent();
  setScreen("patient");
  state.demoMode = false;
  state.interviewActive = true;
  state.sessionStartedAt = Date.now();
  els.demoBadge.hidden = true;
  els.start.disabled = true;
  els.stop.disabled = false;
  const microphoneSupported = navigator.mediaDevices?.getUserMedia && window.MediaRecorder;
  if (microphoneSupported) {
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      showToast(error.name === "NotAllowedError" ? "Microphone access was not allowed. You can continue with text." : "We couldn't access the microphone. You can continue with text.");
    }
  } else {
    showToast("This browser does not support microphone recording. Text fallback is available.");
  }

  try {
    const payload = await api(`/api/interview/start?session_id=${encodeURIComponent(state.sessionId)}&language=${state.language}`, { method: "POST" });
    updateFromPayload(payload);
    await speakResponse(payload);
  } catch (error) {
    state.interviewActive = false;
    els.start.disabled = false;
    els.stop.disabled = true;
    setState("error");
    showToast(friendlyError(error));
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
  setState("completed", "Interview paused. You can continue with text or start a new case.");
}

function base64ToBlob(base64, mime) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: mime });
}

function showAnswerReview(payload) {
  if (!payload.transcript || state.demoMode) {
    speakResponse(payload);
    return;
  }
  state.answerReviewPayload = payload;
  els.answerReviewText.textContent = payload.transcript;
  els.answerReview.hidden = false;
  setState("completed", "Please confirm the transcription before continuing.");
}

function hideAnswerReview() {
  els.answerReview.hidden = true;
  state.answerReviewPayload = null;
}

function finishCompleted() {
  const session = state.session || {};
  const answered = (session.transcript || []).filter((entry) => entry.speaker === "patient").length;
  els.completionAnswers.textContent = answered || "—";
  els.completionDuration.textContent = state.sessionStartedAt ? `${Math.max(1, Math.round((Date.now() - state.sessionStartedAt) / 60000))} min` : "—";
  els.completionLanguage.textContent = languageLabel();
  setScreen("completion");
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
      showToast("The question could not be played. You can continue with text.");
      if (state.interviewActive && state.stream && !payload.interview_complete) startListening();
    };
    try {
      await audio.play();
    } catch {
      showToast("The browser blocked automatic audio. Click the page, then try again.");
      if (state.interviewActive && state.stream && !payload.interview_complete) startListening();
    }
    return;
  }
  if (state.demoMode && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(payload.response);
    utterance.rate = .96;
    utterance.onend = () => payload.interview_complete && finishCompleted();
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
    const payload = await api(`/api/interview/turn?session_id=${encodeURIComponent(state.sessionId)}`, { method: "POST", body: data });
    updateFromPayload(payload);
    showAnswerReview(payload);
  } catch (error) {
    setState("error");
    showToast(friendlyError(error));
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
    showAnswerReview(payload);
  } catch (error) {
    setState("error");
    showToast(friendlyError(error));
  }
}

async function startDemo() {
  await stopInterview();
  setScreen("patient");
  state.demoMode = true;
  state.interviewActive = true;
  state.sessionStartedAt = Date.now();
  els.demoBadge.hidden = false;
  els.start.disabled = true;
  els.stop.disabled = false;
  els.demoNext.hidden = false;
  try {
    const payload = await api(`/api/interview/demo/start?session_id=${encodeURIComponent(state.sessionId)}&language=${state.language}`, { method: "POST" });
    updateFromPayload(payload);
    await speakResponse(payload);
  } catch (error) {
    state.interviewActive = false;
    els.start.disabled = false;
    showToast(friendlyError(error));
  }
}

async function nextDemoStep() {
  if (!state.demoMode) return;
  try {
    const payload = await api(`/api/interview/demo/step?session_id=${encodeURIComponent(state.sessionId)}`, { method: "POST" });
    updateFromPayload(payload);
    await speakResponse(payload);
  } catch (error) {
    showToast(friendlyError(error));
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
    if (type === "number") input.type = "number";
    input.value = type === "list" ? (caseData[field] || []).join("\n") : caseData[field] || "";
    input.placeholder = type === "list" ? "One item per line" : "Not recorded";
    if (type === "list") input.rows = Math.min(4, Math.max(2, (input.value.match(/\n/g) || []).length + 1));
    wrapper.append(title, input);
    els.fields.appendChild(wrapper);
  });
}

function initials(name) {
  return (name || "Patient case").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "PC";
}

function updateReviewControls(session) {
  const reviewed = session.review_status === "reviewed";
  els.caseStatus.className = `case-status ${reviewed ? "reviewed" : "pending"}`;
  els.caseStatus.innerHTML = `<i></i> ${reviewed ? "Reviewed" : "Pending review"}`;
  els.dashboardReview.textContent = reviewed ? "Reviewed" : "Pending review";
  els.dashboardReviewedAt.textContent = reviewed && session.reviewed_at
    ? `Reviewed ${new Date(session.reviewed_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`
    : "Professional review required";
  els.markReviewed.hidden = reviewed;
  els.reopenReview.hidden = !reviewed;
  els.reviewState.textContent = reviewed ? "Reviewed" : session.status === "completed" ? "Ready for review" : "In progress";
}

function renderReviewTranscript(entries = []) {
  els.reviewTranscript.innerHTML = "";
  entries.forEach((entry, index) => {
    const item = document.createElement("div");
    item.className = `review-entry ${entry.speaker}`;
    const header = document.createElement("div");
    header.className = "review-entry-header";
    const role = document.createElement("span");
    role.textContent = entry.speaker === "patient" ? "PATIENT" : "ASSISTANT";
    const edit = document.createElement("button");
    edit.className = "transcript-edit-button";
    edit.textContent = state.editingTranscriptIndex === index ? "Cancel" : "Edit";
    edit.addEventListener("click", () => {
      state.editingTranscriptIndex = state.editingTranscriptIndex === index ? null : index;
      renderReviewTranscript(entries);
    });
    header.append(role, edit);
    item.appendChild(header);
    if (state.editingTranscriptIndex === index) {
      const area = document.createElement("div");
      area.className = "transcript-edit-area";
      const textarea = document.createElement("textarea");
      textarea.rows = 3;
      textarea.value = entry.text;
      const save = document.createElement("button");
      save.textContent = "Save";
      save.addEventListener("click", () => saveTranscriptEdit(index, textarea.value));
      area.append(textarea, save);
      item.appendChild(area);
    } else {
      const text = document.createElement("p");
      text.textContent = entry.edited_text || entry.text;
      item.appendChild(text);
    }
    els.reviewTranscript.appendChild(item);
  });
}

function updateReviewHeader(session) {
  const caseData = session.case || {};
  const name = caseData.patient_name || (session.is_demo ? "Aarav Sharma" : "Patient case");
  els.patientAvatar.textContent = initials(name);
  els.patientName.textContent = name;
  const demographics = [caseData.age && `${caseData.age} years`, caseData.gender].filter(Boolean).join(" · ");
  els.patientDemographics.textContent = demographics || "Information collected through VoiceCase AI";
  els.caseId.textContent = `CASE ${session.session_id.slice(0, 8).toUpperCase()}`;
  els.dashboardStatus.textContent = session.status === "completed" ? "Completed" : "In progress";
  els.dashboardDate.textContent = session.completed_at ? `Completed ${new Date(session.completed_at).toLocaleDateString()}` : "Local session";
  els.dashboardLanguage.textContent = languageNames[session.language] || languageLabel();
  els.notes.value = session.doctor_notes || "";
  updateReviewControls(session);
}

async function loadSessionForReview() {
  try {
    const session = await api(`/api/interview/session?session_id=${encodeURIComponent(state.sessionId)}`);
    state.session = session;
    state.language = session.language || state.language;
    updateLanguage(state.language);
    updateReviewHeader(session);
    renderCaseFields(session.case);
    renderReviewTranscript(session.transcript);
  } catch (error) {
    showToast(friendlyError(error));
  }
}

function showWelcome() {
  setScreen("welcome");
  closeConsent();
}

function showPatientView() {
  setScreen("patient");
}

async function showDoctorView() {
  setScreen("doctor");
  await loadSessionForReview();
}

async function saveCase() {
  if (!state.session) return;
  const updatedCase = {};
  els.fields.querySelectorAll("[data-field]").forEach((input) => {
    const field = input.dataset.field;
    updatedCase[field] = input.tagName === "TEXTAREA"
      ? input.value.split("\n").map((item) => item.trim()).filter(Boolean)
      : input.value.trim();
  });
  els.saveCase.disabled = true;
  els.saveCase.textContent = "Saving...";
  try {
    const session = await api("/api/interview/case", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId, case: updatedCase }),
    });
    state.session = session;
    updateReviewHeader(session);
    renderCaseFields(session.case);
    els.saveMessage.textContent = "Saved in this local session.";
    window.setTimeout(() => (els.saveMessage.textContent = ""), 3000);
  } catch (error) {
    showToast(friendlyError(error));
  } finally {
    els.saveCase.disabled = false;
    els.saveCase.innerHTML = "Save corrections <span>✓</span>";
  }
}

async function saveTranscriptEdit(index, text) {
  if (!text.trim()) return;
  try {
    const session = await api("/api/interview/transcript", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId, index, text: text.trim() }),
    });
    state.session = session;
    state.editingTranscriptIndex = null;
    renderReviewTranscript(session.transcript);
    showToast("Transcript correction saved separately from the case summary.");
  } catch (error) {
    showToast(friendlyError(error));
  }
}

async function saveNotes() {
  els.saveNotes.disabled = true;
  els.saveNotes.textContent = "Saving...";
  try {
    const session = await api("/api/interview/notes", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId, notes: els.notes.value }),
    });
    state.session = session;
    els.notesMessage.textContent = "Note saved.";
    window.setTimeout(() => (els.notesMessage.textContent = ""), 3000);
  } catch (error) {
    showToast(friendlyError(error));
  } finally {
    els.saveNotes.disabled = false;
    els.saveNotes.innerHTML = "Save note <span>✓</span>";
  }
}

async function setReviewed(reviewed) {
  try {
    const session = await api("/api/interview/review", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: state.sessionId, reviewed }),
    });
    state.session = session;
    updateReviewHeader(session);
    showToast(reviewed ? "Case marked as reviewed." : "Case reopened for review.");
  } catch (error) {
    showToast(friendlyError(error));
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

async function clearAndReset(showWelcomeScreen = true) {
  const oldSession = state.sessionId;
  await fetch(`/api/interview/clear?session_id=${encodeURIComponent(oldSession)}`, { method: "POST" }).catch(() => {});
  stopRecording();
  stopStream();
  state.currentAudio?.pause();
  window.speechSynthesis?.cancel();
  state.ws?.close();
  state.sessionId = window.crypto?.randomUUID?.() || `session-${Date.now()}`;
  state.session = null;
  state.demoMode = false;
  state.interviewActive = false;
  state.answerReviewPayload = null;
  state.lastPayload = null;
  state.sessionStartedAt = null;
  els.session.textContent = state.sessionId.slice(0, 6).toUpperCase();
  els.demoBadge.hidden = true;
  els.demoNext.hidden = true;
  els.answerReview.hidden = true;
  els.start.disabled = false;
  els.stop.disabled = true;
  renderTranscript([]);
  els.response.textContent = "Your next question will appear here.";
  els.question.textContent = "When you are ready, tell me what brings you in today.";
  if (showWelcomeScreen) showWelcome();
  connectWebSocket();
  setState("idle");
}

els.languageOptions.forEach((button) => button.addEventListener("click", () => updateLanguage(button.dataset.language)));
els.welcomeStart.addEventListener("click", openConsent);
els.welcomeDemo.addEventListener("click", async () => {
  state.consentGiven = true;
  await startDemo();
});
els.privacyConsent.addEventListener("click", openConsent);
els.consentAgree.addEventListener("click", async () => {
  state.consentGiven = true;
  closeConsent();
  await startInterview();
});
els.consentCancel.addEventListener("click", closeConsent);
els.consentCancelAction.addEventListener("click", closeConsent);
els.brandHome.addEventListener("click", () => clearAndReset(true));
els.patientHome.addEventListener("click", () => clearAndReset(true));
els.start.addEventListener("click", () => (state.consentGiven ? startInterview() : openConsent()));
els.mic.addEventListener("click", () => (state.interviewActive ? stopInterview() : (state.consentGiven ? startInterview() : openConsent())));
els.stop.addEventListener("click", stopInterview);
els.demoNext.addEventListener("click", nextDemoStep);
els.repeat.addEventListener("click", () => state.lastPayload && speakResponse(state.lastPayload));
els.skip.addEventListener("click", () => state.interviewActive && sendText("I prefer not to answer this question."));
els.confirmAnswer.addEventListener("click", async () => {
  const payload = state.answerReviewPayload;
  hideAnswerReview();
  if (payload) await speakResponse(payload);
});
els.retryAnswer.addEventListener("click", () => {
  hideAnswerReview();
  if (state.interviewActive && state.stream) startListening();
  else showToast("You can type the answer below and continue.");
});
els.editAnswer.addEventListener("click", () => {
  const payload = state.answerReviewPayload;
  hideAnswerReview();
  if (payload?.transcript) {
    els.input.value = payload.transcript;
    els.input.focus();
  }
});
els.viewCase.addEventListener("click", showDoctorView);
els.backToPatient.addEventListener("click", showPatientView);
els.newInterview.addEventListener("click", () => clearAndReset(true));
els.printCase.addEventListener("click", async () => {
  await loadSessionForReview();
  window.print();
});
els.saveCase.addEventListener("click", saveCase);
els.saveNotes.addEventListener("click", saveNotes);
els.markReviewed.addEventListener("click", () => setReviewed(true));
els.reopenReview.addEventListener("click", () => setReviewed(false));
els.exportJson.addEventListener("click", () => downloadExport("/api/interview/export.json"));
els.exportTxt.addEventListener("click", () => downloadExport("/api/interview/export.txt"));
els.clear.addEventListener("click", () => clearAndReset(false));
els.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text || state.demoMode) return;
  if (state.recorder?.state === "recording") stopRecording();
  els.input.value = "";
  await sendText(text);
});

updateLanguage(state.language);
setScreen("welcome");
connectWebSocket();
refreshHealth();
window.setInterval(refreshHealth, 10000);