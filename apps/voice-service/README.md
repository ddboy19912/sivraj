# Sivraj Voice Service

Standalone GPU-ready TTS service for Sivraj assistant voices.

The service keeps Python, PyTorch, model weights, and GPU deployment separate from
the TypeScript API. Sivraj API remains responsible for auth, consent, encrypted
storage, and Twin ownership.

## Run

From the repository root:

```bash
cd apps/voice-service
```

Create a Python environment and install the real Chatterbox runtime:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Start the service:

```bash
python -m uvicorn app.main:app --host 0.0.0.0 --port 7860
```

Use `python -m uvicorn` instead of bare `uvicorn` so the command uses the
active `.venv` interpreter. If `uvicorn` resolves to a global `pyenv` binary, it
will not see the Chatterbox package installed in `.venv`.

This service is Chatterbox-only. If Chatterbox is not installed or the runtime
cannot load the model, startup fails instead of returning fake audio.

On first startup, Chatterbox downloads model weights from Hugging Face. This can
be several gigabytes and may look slow on the first run. Set `HF_TOKEN` for
higher Hugging Face rate limits and more reliable downloads:

```bash
export HF_TOKEN=your_hugging_face_token
python -m uvicorn app.main:app --host 0.0.0.0 --port 7860
```

## Connect Sivraj API

For the fastest low-cost hosted voice path, use Cartesia from the Sivraj API:

```env
VOICE_SERVICE_KIND=cartesia
CARTESIA_API_KEY=sk_car_your_key
CARTESIA_VERSION=2026-03-01
CARTESIA_MODEL_ID=sonic-3.5
VOICE_SERVICE_TIMEOUT_MS=45000
```

Use the Chatterbox service below when testing the custom open-source path.

Add these values to the root `.env`:

```env
VOICE_SERVICE_KIND=http
VOICE_SERVICE_URL=http://127.0.0.1:7860
VOICE_SERVICE_API_KEY=
VOICE_SERVICE_TIMEOUT_MS=45000
```

Then start the API and web app from the repository root:

```bash
pnpm dev:api
pnpm dev
```

Open the app, sign in, go to **Assistant Voice**, and click **Preview**.

## Preset Voice Files

Preset voices require owned or explicitly licensed WAV reference clips in:

```text
apps/voice-service/presets/
```

Required filenames:

```text
warm_operator.wav
focused_analyst.wav
energetic_builder.wav
soft_narrator.wav
calm_guide.wav
```

If these clips are missing, Chatterbox can still synthesize with its default
voice, but the named presets will not have distinct custom reference voices.

## Health Check

With the service running:

```bash
curl http://127.0.0.1:7860/health
```

Expected response:

```json
{"ok":"true","engine":"chatterbox","runtime":"chatterbox_turbo"}
```

## Deployment

Deploy to Hugging Face ZeroGPU, RunPod, or a paid Hugging Face GPU Space/Endpoint.
Use `requirements.txt` for the GPU image/Space so the Chatterbox runtime is
installed before startup.

### Hugging Face Space

Create the Space with:

- SDK: `Gradio`
- Template: `Blank`
- Hardware: `ZeroGPU` if you have Hugging Face Pro, otherwise `CPU Basic` only as a temporary wiring test. Chatterbox voice generation is GPU-oriented, so CPU may be too slow for real use.

Upload or commit these files from this folder into the Space repository:

```text
app.py
requirements.txt
app/__init__.py
app/engine.py
app/presets.py
presets/.gitkeep
```

When the owned preset voice clips are ready, also upload:

```text
presets/warm_operator.wav
presets/focused_analyst.wav
presets/energetic_builder.wav
presets/soft_narrator.wav
presets/calm_guide.wav
```

In the Space settings, add these secrets:

```env
VOICE_SERVICE_API_KEY=shared-secret
HF_TOKEN=your_hugging_face_token
```

`VOICE_SERVICE_API_KEY` protects the Space endpoint from casual public use.
`HF_TOKEN` is optional but recommended for faster and more reliable model
downloads.

Then point Sivraj API at the Space from the root `.env`:

```env
VOICE_SERVICE_KIND=gradio
VOICE_SERVICE_URL=https://your-space-subdomain.hf.space
VOICE_SERVICE_API_KEY=shared-secret
VOICE_SERVICE_TIMEOUT_MS=120000
```

Use the Space runtime URL ending in `.hf.space`, not the repository URL ending
in `/spaces/owner/name`.

Optional auth uses a shared secret between Sivraj API and this service:

```bash
VOICE_SERVICE_API_KEY=shared-secret
```

Set the same value in the root `.env`.
