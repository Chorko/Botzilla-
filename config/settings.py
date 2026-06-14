"""
Botzilla — Central Configuration
All pipeline stages import from here. No hardcoded values elsewhere.
"""

import os
import shutil
from pathlib import Path
from dotenv import load_dotenv

# ──────────────────────────────────────────────
# ENV
# ──────────────────────────────────────────────

load_dotenv()

# API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
HF_TOKEN = os.getenv("HF_TOKEN", "")

# Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

# ──────────────────────────────────────────────
# PATHS
# ──────────────────────────────────────────────

ROOT_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = ROOT_DIR / "config"
PROMPTS_DIR = CONFIG_DIR / "prompts"
OUTPUT_DIR = ROOT_DIR / "output"
BIN_DIR = ROOT_DIR / "video" / "bin"

RAW_TRANSCRIPTS_DIR = OUTPUT_DIR / "raw_transcripts"
CLEANED_TRANSCRIPTS_DIR = OUTPUT_DIR / "cleaned_transcripts"
SUMMARIES_DIR = OUTPUT_DIR / "summaries"
DOCUMENTS_DIR = OUTPUT_DIR / "documents"

# Ensure output dirs exist
for d in [RAW_TRANSCRIPTS_DIR, CLEANED_TRANSCRIPTS_DIR, SUMMARIES_DIR, DOCUMENTS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ──────────────────────────────────────────────
# BINARY PATHS (FFmpeg / FFprobe)
# ──────────────────────────────────────────────
# Resolution order:
#   1. Bundled binary in Botzilla-/video/bin/  (always preferred — self-contained)
#   2. System PATH via shutil.which      (fallback if bin/ is absent)
#   3. Startup error with clear message  (never a silent [WinError 2])

def _resolve_binary(name: str) -> str:
    """Resolve ffmpeg/ffprobe to an absolute path. Raises at startup if not found."""
    # Check bundled bin/ first
    bundled = BIN_DIR / (name + ".exe")  # Windows
    if bundled.exists():
        return str(bundled)
    bundled_unix = BIN_DIR / name  # Linux/Mac
    if bundled_unix.exists():
        return str(bundled_unix)
    # Fall back to system PATH
    system = shutil.which(name)
    if system:
        return system
    raise EnvironmentError(
        f"[Botzilla] '{name}' not found.\n"
        f"  → Copy {name}.exe into: {BIN_DIR}\n"
        f"  → Or install FFmpeg and ensure it is on your system PATH."
    )

FFMPEG_PATH  = _resolve_binary("ffmpeg")
FFPROBE_PATH = _resolve_binary("ffprobe")

# ──────────────────────────────────────────────
# WHISPERX & DIARIZATION
# ──────────────────────────────────────────────

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3")  # "tiny", "base", "small", "medium", "large-v3"
WHISPER_BATCH_SIZE = 16
# Auto-detect: float16 on CUDA GPU, int8 on CPU — avoids crash on CPU-only machines
def _detect_compute_type() -> str:
    try:
        import torch
        return "float16" if torch.cuda.is_available() else "int8"
    except ImportError:
        return "int8"

WHISPER_COMPUTE_TYPE = _detect_compute_type()
DIARIZATION_MODEL = "pyannote/speaker-diarization-3.1"
MAX_SPEAKERS = 8
MIN_SPEAKERS = 1

# Audio preprocessing
TARGET_SAMPLE_RATE = 16000  # WhisperX training distribution
TARGET_AUDIO_FORMAT = "wav"

# ──────────────────────────────────────────────
# LLM CONFIGURATION
# ──────────────────────────────────────────────

# Primary LLM for ALL calls: Gemini only
LLM_PROVIDER = "gemini"

# Gemini model for Cleaner (Call #1) and Summary (Call #2)
GEMINI_MODEL = "gemini-2.5-flash"

# ──────────────────────────────────────────────
# CHATBOT TIERED ROUTING
# ──────────────────────────────────────────────

# Tier 1: JSON lookup (exact/keyword match from chatbot_context)
# Tier 2: TF-IDF cosine similarity across topic summaries + key_points
# Tier 3: Gemini API fallback — only when TF-IDF best score < this threshold
CHATBOT_CONFIDENCE_FALLBACK_THRESHOLD = 0.75  # below this → use Gemini

# Max context chunks fed to Gemini fallback (chatbot_context + top N topics)
CHATBOT_GEMINI_CONTEXT_CHUNKS = 4

# ──────────────────────────────────────────────
# CONFIDENCE THRESHOLDS
# ──────────────────────────────────────────────

# Transcription confidence below this → is_low_confidence = true
LOW_CONFIDENCE_THRESHOLD = 0.70

# Speaker name confidence below this → inferred_name must be null
NAME_CONFIDENCE_THRESHOLD = 0.65

# Filler words — segments containing ONLY these are marked is_filler_only
FILLER_WORDS = {
    "um", "uh", "hmm", "hm", "ah", "oh", "okay", "ok", "yeah", "yes",
    "right", "like", "so", "well", "you know", "i mean",
    "haan", "haa", "acha", "theek", "ha",  # Hindi/Hinglish fillers
}

# Minimum segment duration — below this → low_confidence_flag "very_short"
VERY_SHORT_SEGMENT_THRESHOLD = 0.5  # seconds

# ──────────────────────────────────────────────
# VIDEO / SLIDE EXTRACTION
# ──────────────────────────────────────────────

# Smart slide window formula (locked — do not change without discussion)
# window_seconds = min(context_duration_seconds * SLIDE_WINDOW_PERCENTAGE, SLIDE_WINDOW_CAP_SECONDS)
SLIDE_WINDOW_PERCENTAGE = 0.05  # 5% of context duration
SLIDE_WINDOW_CAP_SECONDS = 180  # 3 minute cap

# Frame extraction
FRAME_HEARTBEAT_INTERVAL = 7  # seconds between forced frame captures
SCENE_CHANGE_THRESHOLD = 0.02  # FFmpeg scene detection sensitivity (0.0 - 1.0)
FRAME_WIDTH = 640
FRAME_HEIGHT = 360

# OCR
OCR_LANGUAGES = ["en"]
OCR_SIMILARITY_THRESHOLD = 90.0  # fuzzy dedup threshold (0-100)

# ──────────────────────────────────────────────
# SCHEMA VERSIONS
# ──────────────────────────────────────────────

SCHEMA_VERSION = "1.0"

# ──────────────────────────────────────────────
# MEETING TYPES
# ──────────────────────────────────────────────

VALID_MEETING_TYPES = [
    "standup", "review", "brainstorm", "one_on_one", "all_hands",
    "interview", "lecture", "workshop", "casual", "game_session", "unknown",
]

VALID_TONES = ["formal", "semi-formal", "casual"]

VALID_OUTCOMES = [
    "productive", "inconclusive", "action-heavy",
    "informational", "casual", "mixed",
]

VALID_SENTIMENTS = ["positive", "neutral", "mixed", "tense", "negative"]

# ──────────────────────────────────────────────
# HELPER: Load prompt files
# ──────────────────────────────────────────────

def load_prompt(filename: str) -> str:
    """Load a prompt template from config/prompts/"""
    prompt_path = PROMPTS_DIR / filename
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")
