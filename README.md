# Local Patient Case-Taking Assistant

This project is a local-first patient case-taking assistant for Windows:

```text
Microphone → FastAPI → faster-whisper small (CPU/int8) → Ollama qwen3:8b
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

### 4. Download and verify faster-whisper

For this CPU-only laptop, use the `small` model with CPU `int8` inference. Download/cache it once with:

```powershell
python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8'); print('faster-whisper small is ready')"
```

This command downloads the model and confirms that the Python environment can load it. Whisper is **not a separate server**. FastAPI loads the model into memory the first time a real microphone recording is transcribed, then reuses it for later turns.

## Start all local services

Use three PowerShell windows. Keep the first three windows open while using the application.

### Window 1 — start Ollama

Ollama must be running before a real interview can generate the next question.

If the Ollama desktop application is already running, you can skip the start command and go straight to the checks:

```powershell
ollama serve
```

If you see an error saying that port `11434` is already in use, Ollama is probably already running. Do not start a second copy.

Check that Ollama responds:

```powershell
Invoke-RestMethod http://127.0.0.1:11434/api/tags
```

Install the model once if it is not already listed:

```powershell
ollama pull qwen3:8b
ollama list
```

The `ollama list` output must include `qwen3:8b`. The application uses:

```text
Ollama URL:   http://127.0.0.1:11434
Ollama model: qwen3:8b
```

### Window 2 — start Piper

Piper is the local text-to-speech HTTP service. It is not started by FastAPI. Keep this window open while using the application.

From the project folder, with the virtual environment active:

```powershell
python -m piper.http_server -m "C:\Users\morax\Local-Voice-Case-Taker\en_US-lessac-medium.onnx" --host 127.0.0.1 --port 5000
```

This uses the Lessac medium voice already in this project and listens at:

```text
Address: http://127.0.0.1:5000
Voice:   en_US-lessac-medium
Route:   POST /synthesize
```

The service must accept JSON containing `text` and return WAV audio. This application sends:

```text
{"text":"Hello from VoiceCase AI","voice":"en_US-lessac-medium"}
```

This Piper server chooses the voice at startup and may reject the `voice` property. The app automatically retries with only `{"text":"..."}` when that happens.

Check Piper before starting FastAPI:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/health
```

If `/health` is not provided, opening `http://127.0.0.1:5000/` or checking the Piper terminal is also acceptable. The VoiceCase health check accepts either a successful `/health` or `/` response.

### Window 3 — start FastAPI

With the virtual environment active:

```powershell
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

FastAPI is the application server. It connects the browser to Whisper, Ollama, and Piper. Leave this window running.

### Open the application

Open this URL in your browser:

```text
http://127.0.0.1:8000
```

## Understand the service status

The application checks all three local dependencies at:

```text
http://127.0.0.1:8000/health
```

Run this in PowerShell:

```powershell
$health = Invoke-RestMethod http://127.0.0.1:8000/health
$health | ConvertTo-Json -Depth 4
```

Healthy status looks like:

```json
{
  "status": "ok",
  "ollama": "online",
  "piper": "online",
  "whisper": "ready"
}
```

The browser's **Local System** strip uses the same values:

| Status | Meaning | What to do |
|---|---|---|
| `Ollama online` | Ollama answered at port 11434 and the local model can be used. | Nothing; keep Ollama running. |
| `Piper online` | Piper answered at port 5000. | Nothing; keep Piper running. |
| `Whisper ready` | faster-whisper has loaded `small` into memory. | Nothing; microphone transcription is ready. |
| `Whisper not_loaded` | FastAPI is running, but Whisper has not loaded yet. | This is normal before the first real voice transcription. Click **Start Interview** and make one recording. |
| `Whisper failed` | Whisper tried to load but could not. | Check the FastAPI terminal, the Python environment, and the model cache. |
| `offline` | FastAPI could not reach that local service. | Start that service and refresh the page. |

The overall health may show `"status": "degraded"` with `"whisper": "not_loaded"` immediately after startup. That is expected because Whisper is lazy-loaded. After the first real microphone turn, the FastAPI terminal should show:

```text
Loading Whisper model: small (cpu/int8)
Whisper model loaded successfully
```

After that, refresh `/health`; Whisper should say `"ready"`. Demo Mode does not load Whisper because it intentionally bypasses the microphone and local AI services.

## Test the microphone

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
- Clinician notes, review status, transcript corrections, and print-ready case output

The demo is clearly marked **DEMO MODE — FICTIONAL DATA** and does not contain real patient information.

## Configuration

Copy `.env.example` to `.env` to override local defaults. The important values are:

```text
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3:8b
PIPER_URL=http://127.0.0.1:5000
PIPER_VOICE=en_US-lessac-medium
WHISPER_MODEL=small
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
```

Keep these values for the stated i5 CPU-only hardware. If you intentionally change the local faster-whisper runtime, update all three values together:

```text
WHISPER_MODEL=<local-model-name>
WHISPER_DEVICE=<cpu-or-supported-device>
WHISPER_COMPUTE_TYPE=<supported-compute-type>
```

## Architecture

- `backend/stt.py` defines the `STTProvider` interface and the `LocalWhisperProvider`.
- `backend/llm.py` defines the `LLMProvider` interface and the reusable-client `OllamaProvider`.
- `backend/tts.py` defines the `TTSProvider` interface and the reusable-client `PiperProvider`.
- `backend/conversation.py` keeps the original generic voice history for the first pipeline.
- `backend/case_taking.py` defines the editable medical case schema, safety prompt, ephemeral sessions, transcript preservation, and fictional demo data.
- `backend/main.py` exposes `/health`, patient voice/text interview routes, demo routes, clinician review/export routes, and a small WebSocket for state updates.
- `frontend/` contains the VoiceCase AI welcome/consent flow, language selection, patient interview screen, microphone/audio loop, answer confirmation, completion screen, clinician workspace, editable case fields/transcript, notes, review status, printing, and export actions.

The provider boundaries make it possible to replace STT, LLM, or TTS later without changing the medical case store and browser layers. Case data and transcript are held in memory only and disappear when the process exits unless explicitly exported.

## Medical safety and privacy

- The assistant never presents itself as a doctor.
- It does not diagnose, prescribe, recommend treatment, or tell a patient to change medication.
- Original patient transcript entries are retained separately from structured case fields.
- Clinician corrections update only the structured fields; transcript corrections are stored separately from the original source text.
- Clinician notes are stored separately from AI-assisted information.
- Review status can be marked as reviewed and reopened.
- Audio files are temporary and removed after transcription.
- Patient audio, transcript, and case data are not logged or persisted by default.
- The clinician review screen includes the reminder: “Information should be reviewed by a qualified clinician.”

## Medical API routes

- `POST /api/interview/start?session_id=...` — start a real local interview and speak the opening question
- `POST /api/interview/transcribe?session_id=...` — transcribe one microphone answer without saving it, so the patient can confirm or retry it
- `POST /api/interview/turn?session_id=...` — transcribe a microphone recording and advance the structured interview
- `POST /api/interview/text-turn` — text fallback for the same case-taking flow
- `POST /api/interview/demo/start` and `POST /api/interview/demo/step` — fictional local demonstration flow
- `GET /api/interview/session?session_id=...` — retrieve the in-memory case and original transcript
- `PUT /api/interview/case` — save clinician corrections to structured fields only
- `PUT /api/interview/session` — save the selected interview language
- `PUT /api/interview/transcript` — save a separate clinician correction for one transcript entry
- `PUT /api/interview/notes` — save clinician notes
- `PUT /api/interview/review` — mark the case reviewed or reopen it
- `GET /api/interview/export.json` and `/api/interview/export.txt` — local downloads
- `POST /api/interview/clear` — discard the in-memory session

## Troubleshooting

- **Whisper unavailable:** check the FastAPI terminal and `/health`. The model is loaded once on the first transcription request and must be installed/cached locally.
- **Ollama offline/model missing:** make sure Ollama is running and `ollama list` includes `qwen3:8b`.
- **Piper offline/voice missing:** start Piper with `python -m piper.http_server -m "C:\Users\morax\Local-Voice-Case-Taker\en_US-lessac-medium.onnx" --host 127.0.0.1 --port 5000` and confirm it is listening on port 5000.
- **AI service unavailable:** check Ollama and confirm `qwen3:8b` is installed. Demo Mode remains available without Ollama.
- **Voice service unavailable:** check Piper. The text fallback can continue the interview without spoken output.
- **No speech detected:** speak closer to the microphone, reduce background noise, and pause after your sentence.
- **Microphone denied:** allow microphone access for `127.0.0.1` in the browser settings, then reload.