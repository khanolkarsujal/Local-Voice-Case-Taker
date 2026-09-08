# Local Real-Time Voice Chatbot

This project is a local-first voice loop for Windows:

```text
Microphone → FastAPI → faster-whisper large-v3 → Ollama qwen3:8b
          → Piper en_US-lessac-medium → WAV → browser speaker
```

No cloud AI, paid inference API, browser TTS, or public service endpoint is required. Replit can be used to edit the project, but the final application must run on the Windows computer that has Ollama, Piper, and faster-whisper installed.

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
3. Speak a complete sentence and pause briefly.
4. The recording stops after a short silence.
5. The browser shows the transcript, sends it to local Ollama, synthesizes the answer through local Piper, and plays the returned WAV.
6. The next listening turn starts automatically while the interview is active.

The text field is available as a fallback if microphone permissions are unavailable.

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
- `backend/conversation.py` keeps bounded conversation history per browser session.
- `backend/main.py` exposes `/health`, voice/text turn routes, a clear route, and a small WebSocket for state updates.
- `frontend/` contains the voice-first HTML, CSS, and browser recording/audio logic.

The provider boundaries make it possible to replace STT, LLM, or TTS later without changing the conversation and browser layers.

## Troubleshooting

- **Whisper unavailable:** check the FastAPI terminal. The model is loaded during startup and must be installed/cached locally.
- **Ollama offline/model missing:** make sure Ollama is running and `ollama list` includes `qwen3:8b`.
- **Piper offline/voice missing:** confirm the Piper server is listening on port 5000 and has the Lessac voice installed.
- **No speech detected:** speak closer to the microphone, reduce background noise, and pause after your sentence.
- **Microphone denied:** allow microphone access for `127.0.0.1` in the browser settings, then reload.