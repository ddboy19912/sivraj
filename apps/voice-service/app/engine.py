import base64
import io
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from .presets import VOICE_PRESETS


@dataclass
class SynthesisRequest:
    text: str
    voiceId: str
    language: str = "en"
    style: str | None = None
    exaggeration: float | None = None
    referenceAudioBase64: str | None = None
    referenceMimeType: str | None = None


class ChatterboxVoiceEngine:
    def __init__(self) -> None:
        try:
            from chatterbox.tts_turbo import ChatterboxTurboTTS
            import perth
            import torch
        except Exception as exc:  # pragma: no cover - depends on GPU deployment image
            raise RuntimeError(
                "Chatterbox is not installed. Install the GPU voice dependencies "
                "from requirements.txt before starting this service."
            ) from exc

        if getattr(perth, "PerthImplicitWatermarker", None) is None:
            class IdentityWatermarker:
                def apply_watermark(self, wav, **_: object):
                    return wav

            perth.PerthImplicitWatermarker = IdentityWatermarker

        device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model = ChatterboxTurboTTS.from_pretrained(device=device)

    def synthesize(self, request: SynthesisRequest) -> bytes:
        audio_prompt_path = self._reference_path(request)
        kwargs = {
            "audio_prompt_path": str(audio_prompt_path) if audio_prompt_path else None,
        }
        if request.exaggeration is not None:
            kwargs["exaggeration"] = request.exaggeration

        wav = self.model.generate(request.text, **kwargs)
        sample_rate = getattr(self.model, "sr", 24_000)
        buffer = io.BytesIO()
        sf.write(buffer, np.asarray(wav).squeeze(), sample_rate, format="WAV")
        return buffer.getvalue()

    def _reference_path(self, request: SynthesisRequest) -> Path | None:
        if request.referenceAudioBase64:
            reference_bytes = base64.b64decode(request.referenceAudioBase64)
            tmp_path = Path("/tmp") / f"sivraj-{request.voiceId}-reference.wav"
            tmp_path.write_bytes(reference_bytes)
            return tmp_path

        preset = VOICE_PRESETS.get(request.voiceId)
        if not preset:
            return None

        return preset.reference_path if preset.reference_path.exists() else None
