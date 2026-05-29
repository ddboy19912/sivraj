import base64
import os
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, Field

from .engine import ChatterboxVoiceEngine
from .engine import SynthesisRequest as EngineSynthesisRequest
from .presets import VOICE_PRESETS


class SynthesisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2_000)
    voiceId: str
    language: str = "en"
    style: str | None = None
    exaggeration: float | None = Field(default=None, ge=0, le=2)
    referenceAudioBase64: str | None = None
    referenceMimeType: str | None = None


def load_engine() -> ChatterboxVoiceEngine:
    return ChatterboxVoiceEngine()


app = FastAPI(title="Sivraj Voice Service")
engine = load_engine()


def require_api_key(
    authorization: Annotated[str | None, Header()] = None,
) -> None:
    expected = os.getenv("VOICE_SERVICE_API_KEY")
    if not expected:
        return

    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="invalid_api_key")


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "ok": "true",
        "engine": "chatterbox",
        "runtime": os.getenv("VOICE_RUNTIME", "chatterbox_turbo"),
    }


@app.post("/synthesize")
def synthesize(
    request: SynthesisRequest,
    _: Annotated[None, Depends(require_api_key)],
) -> Response:
    if request.voiceId != "custom_clone" and request.voiceId not in VOICE_PRESETS:
        raise HTTPException(status_code=400, detail="unknown_voice_id")

    if request.voiceId == "custom_clone" and not request.referenceAudioBase64:
        raise HTTPException(status_code=400, detail="missing_reference_audio")

    audio = engine.synthesize(EngineSynthesisRequest(**request.model_dump()))
    return Response(content=audio, media_type="audio/wav")
