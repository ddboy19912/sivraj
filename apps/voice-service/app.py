import base64
import os
import traceback

import gradio as gr

try:
    import spaces
except Exception:  # pragma: no cover - only present on Hugging Face ZeroGPU
    class spaces:  # type: ignore[no-redef]
        @staticmethod
        def GPU(*args, **kwargs):
            def decorator(fn):
                return fn

            return decorator

from app.engine import ChatterboxVoiceEngine, SynthesisRequest
from app.presets import VOICE_PRESETS


engine: ChatterboxVoiceEngine | None = None


def get_engine() -> ChatterboxVoiceEngine:
    global engine
    if engine is None:
        engine = ChatterboxVoiceEngine()
    return engine


def require_api_key(api_key: str) -> None:
    expected = os.getenv("VOICE_SERVICE_API_KEY", "")
    if expected and api_key != expected:
        raise gr.Error("invalid_api_key")


@spaces.GPU(duration=120)
def synthesize(
    text: str,
    voice_id: str,
    language: str,
    style: str,
    exaggeration: float,
    reference_audio_base64: str,
    reference_mime_type: str,
    api_key: str,
) -> str:
    require_api_key(api_key)

    if voice_id != "custom_clone" and voice_id not in VOICE_PRESETS:
        raise gr.Error("unknown_voice_id")

    if voice_id == "custom_clone" and not reference_audio_base64:
        raise gr.Error("missing_reference_audio")

    try:
        audio = get_engine().synthesize(
            SynthesisRequest(
                text=text,
                voiceId=voice_id,
                language=language or "en",
                style=style or None,
                exaggeration=exaggeration,
                referenceAudioBase64=reference_audio_base64 or None,
                referenceMimeType=reference_mime_type or None,
            ),
        )
        return base64.b64encode(audio).decode("ascii")
    except gr.Error:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise gr.Error(f"{type(exc).__name__}: {exc}") from exc


with gr.Blocks(title="Sivraj Voice Service") as demo:
    gr.Markdown("# Sivraj Voice Service")
    gr.Markdown("Chatterbox Turbo voice synthesis endpoint for Sivraj.")
    text = gr.Textbox(label="Text", value="Hello from Sivraj.")
    voice_id = gr.Dropdown(
        label="Voice",
        choices=list(VOICE_PRESETS.keys()) + ["custom_clone"],
        value="warm_operator",
    )
    language = gr.Textbox(label="Language", value="en")
    style = gr.Textbox(label="Style", value="")
    exaggeration = gr.Slider(label="Exaggeration", minimum=0, maximum=2, value=0)
    reference_audio_base64 = gr.Textbox(label="Reference audio base64", visible=False)
    reference_mime_type = gr.Textbox(label="Reference MIME type", visible=False)
    api_key = gr.Textbox(label="API key", type="password", visible=False)
    output = gr.Textbox(label="Audio WAV base64")
    button = gr.Button("Synthesize")
    button.click(
        synthesize,
        inputs=[
            text,
            voice_id,
            language,
            style,
            exaggeration,
            reference_audio_base64,
            reference_mime_type,
            api_key,
        ],
        outputs=output,
        api_name="synthesize",
    )

demo.queue(api_open=True)

if __name__ == "__main__":
    demo.launch(show_error=True)
