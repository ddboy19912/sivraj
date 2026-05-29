from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class VoicePreset:
    id: str
    name: str
    description: str
    language: str
    style: str
    reference_path: Path


PRESET_DIR = Path(__file__).resolve().parents[1] / "presets"

VOICE_PRESETS = {
    "warm_operator": VoicePreset(
        id="warm_operator",
        name="Skylar",
        description="Approachable American female voice for friendly guidance.",
        language="en",
        style="warm",
        reference_path=PRESET_DIR / "warm_operator.wav",
    ),
    "focused_analyst": VoicePreset(
        id="focused_analyst",
        name="Daniel",
        description="Clear American male voice for crisp assistant responses.",
        language="en",
        style="focused",
        reference_path=PRESET_DIR / "focused_analyst.wav",
    ),
    "energetic_builder": VoicePreset(
        id="energetic_builder",
        name="Corey",
        description="Cheerful American male voice for casual conversation.",
        language="en",
        style="energetic",
        reference_path=PRESET_DIR / "energetic_builder.wav",
    ),
    "soft_narrator": VoicePreset(
        id="soft_narrator",
        name="Gemma",
        description="Confident British female voice for professional assistance.",
        language="en",
        style="soft",
        reference_path=PRESET_DIR / "soft_narrator.wav",
    ),
    "calm_guide": VoicePreset(
        id="calm_guide",
        name="Archie",
        description="Warm British male voice for relaxed dialogue.",
        language="en",
        style="calm",
        reference_path=PRESET_DIR / "calm_guide.wav",
    ),
}
