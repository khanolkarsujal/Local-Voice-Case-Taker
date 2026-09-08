# Local Patient Case-Taking Assistant

This project is a local-first patient case-taking assistant for Windows:

```text
Microphone → FastAPI → faster-whisper large-v3 → Ollama qwen3:8b
           → Piper en_US-lessac-medium → WAV → browser speaker
```

The assistant only collects and organizes patient information for clinician review. It is not a diagnostic or treatment system. No cloud AI, paid inference API, browser TTS, or public service endpoint is required. Replit can be used to edit the project, but the final application must run on the Windows computer that has Ollama, Piper, and faster-whisper installed.

## Windows setup

### 1. Create a virtual environment

Open PowerShell in this project folder:

```powershell
py -3.11 -m venv .venv
```

### 2. Activate the environment

```powershell
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, run PowerShell as your user and allow local scripts:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then activate again.

### 3. Install Python dependencies

```powershell
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Verify faster-whisper

The first model load can take time if `large-v3` has not been cached yet:

```powershell
python -c "from faster_whisper import WhisperModel; WhisperModel('large-v3', device='cpu', compute_type='int8'); print('faster-whisper is ready')"
```

### 5. Verify Ollama is running

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

### 6. Verify qwen3:8b

Install it once if it is not already listed:

```powershell
ollama pull qwen3:8b
ollama list
```

### 7. Start Piper

Start the local Piper HTTP service using the Piper server command you already use. It must listen on:

```text
http://127.0.0.1:5000
```

It should expose `POST /synthesize` and accept a JSON body containing `text`. This app also sends `voice: en_US-lessac-medium` for Piper wrappers that support per-request voice selection.

### 8. Start FastAPI

With the virtual environment active:

```powershell
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

The first startup loads `large-v3` once. It is not reloaded for each recording.

### 9. Open the browser

Open:

```text
http://127.0.0.1:8000
```

The app also serves a health endpoint at `http://127.0.0.1:8000/health`.

### 10. Test the microphone

1. Click **Start Interview**.
2. Allow microphone access when the browser asks.
3. The assistant will speak: “Hello. I'm the patient case-taking assistant...” and ask what brings you in.
4. Speak a complete sentence and pause briefly.
5. The recording stops after a short silence.
6. The browser shows the original transcript, sends the answer to local Ollama for structured case updates and the next question, synthesizes that question through local Piper, and plays the returned WAV.
7. The next listening turn starts automatically while the interview is active.
8. When the interview is complete, the clinician review screen opens.

The text field is available as a fallback if microphone permissions are unavailable.

### Demo Mode

Click **Run Fictional Demo** to demonstrate the whole workflow without microphone access, Whisper, Ollama, or Piper. It uses fictional cough information only and includes:

- A guided patient interview with one question at a time
- Original fictional patient answers
- Structured case extraction
- Clinician review and editable fields
- JSON and TXT export

The demo is clearly marked **DEMO MODE — FICTIONAL DATA** and does not contain real patient information.

## Configuration

Copy `.env.example` to `.env` to override local defaults. The important values are:

```text
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
PIPER_URL=http://127.0.0.1:5000
PIPER_VOICE=en_US-lessac-medium
WHISPER_MODEL=large-v3
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
```

For a compatible CUDA installation, use:

```text
WHISPER_DEVICE=cuda
WHISPER_COMPUTE_TYPE=float16
```

## Architecture

- `backend/stt.py` defines the `STTProvider` interface and the `LocalWhisperProvider`.
- `backend/llm.py` defines the `LLMProvider` interface and the reusable-client `OllamaProvider`.
- `backend/tts.py` defines the `TTSProvider` interface and the reusable-client `PiperProvider`.
- `backend/conversation.py` keeps the original generic voice history for the first pipeline.
- `backend/case_taking.py` defines the editable medical case schema, safety prompt, ephemeral sessions, transcript preservation, and fictional demo data.
- `backend/main.py` exposes `/health`, patient voice/text interview routes, demo routes, clinician review/export routes, and a small WebSocket for state updates.
- `frontend/` contains the patient interview screen, microphone/audio loop, demo controls, clinician review, editable case fields, and export actions.

The provider boundaries make it possible to replace STT, LLM, or TTS later without changing the medical case store and browser layers. Case data and transcript are held in memory only and disappear when the process exits unless explicitly exported.

## Medical safety and privacy

- The assistant never presents itself as a doctor.
- It does not diagnose, prescribe, recommend treatment, or tell a patient to change medication.
- Original patient transcript entries are retained separately from structured case fields.
- Clinician corrections update only the structured fields; they do not silently change the original transcript.
- Audio files are temporary and removed after transcription.
- Patient audio, transcript, and case data are not logged or persisted by default.
- The clinician review screen includes the reminder: “Information should be reviewed by a qualified clinician.”

## Medical API routes

- `POST /api/interview/start?session_id=...` — start a real local interview and speak the opening question
- `POST /api/interview/turn?session_id=...` — transcribe a microphone recording and advance the structured interview
- `POST /api/interview/text-turn` — text fallback for the same case-taking flow
- `POST /api/interview/demo/start` and `POST /api/interview/demo/step` — fictional local demonstration flow
- `GET /api/interview/session?session_id=...` — retrieve the in-memory case and original transcript
- `PUT /api/interview/case` — save clinician corrections to structured fields only
- `GET /api/interview/export.json` and `/api/interview/export.txt` — local downloads
- `POST /api/interview/clear` — discard the in-memory session

## Troubleshooting

- **Whisper unavailable:** check the FastAPI terminal. The model is loaded during startup and must be installed/cached locally.
- **Ollama offline/model missing:** make sure Ollama is running and `ollama list` includes `qwen3:8b`.
- **Piper offline/voice missing:** confirm the Piper server is listening on port 5000 and has the Lessac voice installed.
- **AI service unavailable:** check Ollama and confirm `qwen3:8b` is installed. Demo Mode remains available without Ollama.
- **Voice service unavailable:** check Piper. The text fallback can continue the interview without spoken output.
- **No speech detected:** speak closer to the microphone, reduce background noise, and pause after your sentence.
- **Microphone denied:** allow microphone access for `127.0.0.1` in the browser settings, then reload.