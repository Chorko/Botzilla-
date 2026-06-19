"""
Botzilla — Pipeline Orchestrator
Routes input files through the appropriate pipeline stages.

Usage:
    python main.py <audio_or_video_file> [--output-dir <dir>] [--whisper-model <model>]

Pipeline A (Audio):
    audio_engine.py → cleaner.py → summary_model.py → generate_docx.js

Pipeline B (Video):
    video_processor.py (extract audio + frames)
    → audio_engine.py → cleaner.py
    → smart_slide.py (uses cleaner context timestamps)
    → summary_model.py → generate_docx.js
"""

import sys
if sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

import os
import uuid
import json
import time
import argparse
import subprocess
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config.settings import (
    OUTPUT_DIR, RAW_TRANSCRIPTS_DIR, CLEANED_TRANSCRIPTS_DIR,
    SUMMARIES_DIR, DOCUMENTS_DIR, HF_TOKEN, GROQ_API_KEY,
    GEMINI_API_KEY, WHISPER_MODEL,
)


# ──────────────────────────────────────────────
# File type detection
# ──────────────────────────────────────────────

AUDIO_EXTENSIONS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".wma"}
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".wmv"}


def detect_input_type(file_path: str) -> str:
    """Detect whether input is audio or video based on extension."""
    ext = Path(file_path).suffix.lower()
    if ext in AUDIO_EXTENSIONS:
        return "audio"
    elif ext in VIDEO_EXTENSIONS:
        return "video"
    else:
        raise ValueError(f"Unsupported file format: {ext}")


# ──────────────────────────────────────────────
# Pipeline stages
# ──────────────────────────────────────────────

def run_audio_pipeline(input_file: str, meeting_id: str, output_dir: Path) -> dict:
    """
    Stage 1: Audio → Schema 1 (Raw Transcript)
    Stage 2: Schema 1 → Schema 2 (Cleaner Output)
    Stage 3: Schema 2 → Schema 3 (Summary JSON)
    Stage 4: Schema 3 → .docx
    """
    from audio.audio_engine import process_audio
    from models.cleaner import clean_transcript
    from models.summary_model import generate_summary

    # Stage 1: Transcribe + Diarize
    print(f"\n{'='*60}")
    print(f"[STAGE 1/4] Audio Engine — Transcription & Diarization")
    print(f"{'='*60}")
    raw_transcript = process_audio(input_file, meeting_id)

    raw_path = output_dir / f"{meeting_id}_raw.json"
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(raw_transcript, f, indent=2, ensure_ascii=False)
    print(f"[✓] Raw transcript saved: {raw_path}")

    # Stage 2: Clean
    print(f"\n{'='*60}")
    print(f"[STAGE 2/4] Cleaner — LLM Call #1")
    print(f"{'='*60}")
    cleaned = clean_transcript(raw_transcript)

    cleaned_path = output_dir / f"{meeting_id}_cleaned.json"
    with open(cleaned_path, "w", encoding="utf-8") as f:
        json.dump(cleaned, f, indent=2, ensure_ascii=False)
    print(f"[✓] Cleaned transcript saved: {cleaned_path}")

    # Stage 3: Summarize
    print(f"\n{'='*60}")
    print(f"[STAGE 3/4] Summary Model — LLM Call #2 + App Enrichment")
    print(f"{'='*60}")
    summary = generate_summary(cleaned, source_type="audio")

    summary_path = output_dir / f"{meeting_id}_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"[✓] Summary JSON saved: {summary_path}")

    # Stage 4: DOCX
    print(f"\n{'='*60}")
    print(f"[STAGE 4/4] DOCX Generator")
    print(f"{'='*60}")
    docx_path = output_dir / f"{meeting_id}_summary.docx"
    generate_docx(str(summary_path), str(docx_path))

    return summary


def run_video_pipeline(input_file: str, meeting_id: str, output_dir: Path) -> dict:
    """
    Full video pipeline (Pipeline B):
    1. video_processor.py — extract audio WAV + scene-change frames
    2. audio_engine.py   — transcribe + diarize → Schema 1
    3. cleaner.py        — LLM Call #1 → Schema 2
    4. ocr_processor.py  — OCR on extracted frames
    5. smart_slide.py    — select best slide per context boundary → slides[]
    6. summary_model.py  — LLM Call #2 + app enrichment → Schema 3
    7. generate_docx.js  — Schema 3 → .docx (with inline slide images)
    """
    from video.video_processor import process_video
    from audio.audio_engine import process_audio
    from models.cleaner import clean_transcript
    from video.ocr_processor import score_frames, ocr_selected_slides
    from video.smart_slide import select_slides
    from models.summary_model import generate_summary

    slides_dir = output_dir / "slides"

    # Stage 1: Extract audio + frames
    print(f"\n{'='*60}")
    print(f"[STAGE 1/6] Video Processor — Splitting audio & frames")
    print(f"{'='*60}")
    video_result = process_video(input_file, str(output_dir))
    audio_path = video_result["audio_path"]
    frames = video_result["frames"]
    print(f"[✓] Audio: {Path(audio_path).name} | Frames: {len(frames)}")

    # Stage 2: Transcribe + Diarize
    print(f"\n{'='*60}")
    print(f"[STAGE 2/6] Audio Engine — Transcription & Diarization")
    print(f"{'='*60}")
    raw_transcript = process_audio(audio_path, meeting_id, source_type="video",
                                   extracted_audio_path=audio_path)

    raw_path = output_dir / f"{meeting_id}_raw.json"
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(raw_transcript, f, indent=2, ensure_ascii=False)
    print(f"[✓] Raw transcript saved: {raw_path}")

    # Stage 3: Clean
    print(f"\n{'='*60}")
    print(f"[STAGE 3/6] Cleaner — LLM Call #1")
    print(f"{'='*60}")
    cleaned = clean_transcript(raw_transcript)

    cleaned_path = output_dir / f"{meeting_id}_cleaned.json"
    with open(cleaned_path, "w", encoding="utf-8") as f:
        json.dump(cleaned, f, indent=2, ensure_ascii=False)
    print(f"[✓] Cleaned transcript saved: {cleaned_path}")

    # Stage 4: Fast-score all frames (sharpness + visual dedup, no OCR)
    print(f"\n{'='*60}")
    print(f"[STAGE 4/6] Frame Scorer — Visual dedup & quality scoring")
    print(f"{'='*60}")
    scored_frames = score_frames(frames) if frames else []
    print(f"[✓] Scored {len(scored_frames)} frames")

    # Stage 5: Smart slide selection (picks best frame per context)
    print(f"\n{'='*60}")
    print(f"[STAGE 5/6] Smart Slide Selector — Best frame per context")
    print(f"{'='*60}")
    slides = select_slides(cleaned, scored_frames, str(slides_dir), meeting_id)

    # Stage 5b: Run OCR on selected slides only (much faster than all frames)
    if slides:
        print(f"[STAGE 5b] OCR — Running on {len(slides)} selected slides...")
        slides = ocr_selected_slides(slides)
    print(f"[✓] {len(slides)} slides selected")

    # Stage 6: Summarize (with slides)
    print(f"\n{'='*60}")
    print(f"[STAGE 6/6] Summary Model — LLM Call #2 + App Enrichment")
    print(f"{'='*60}")
    summary = generate_summary(cleaned, source_type="video", slides=slides)

    summary_path = output_dir / f"{meeting_id}_summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2, ensure_ascii=False)
    print(f"[✓] Summary JSON saved: {summary_path}")

    # DOCX
    print(f"\n{'='*60}")
    print(f"[DOCX] Generating Word document with embedded slides...")
    print(f"{'='*60}")
    docx_path = output_dir / f"{meeting_id}_summary.docx"
    generate_docx(str(summary_path), str(docx_path))

    return summary


def generate_docx(summary_json_path: str, output_docx_path: str):
    """Run the Node.js DOCX generator."""
    models_dir = Path(__file__).resolve().parent / "models"
    docx_script = models_dir / "generate_docx.js"

    if not docx_script.exists():
        print(f"[✗] DOCX generator not found: {docx_script}")
        return

    result = subprocess.run(
        ["node", str(docx_script), summary_json_path, output_docx_path],
        capture_output=True, text=True,
    )

    if result.returncode == 0:
        print(result.stdout)
    else:
        print(f"[✗] DOCX generation failed:")
        print(result.stderr)


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Botzilla — AI Meeting Summarizer Pipeline",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python main.py meeting.mp3
  python main.py lecture.mp4 --output-dir ./results
  python main.py interview.wav --whisper-model base
        """,
    )
    parser.add_argument("input_file", help="Path to audio or video file")
    parser.add_argument("--output-dir", "-o", default=None, help="Output directory (default: output/<meeting_id>)")
    parser.add_argument("--whisper-model", "-m", default=None, help="WhisperX model size (tiny/base/small/medium/large-v3)")
    parser.add_argument("--meeting-id", default=None, help="Custom meeting ID (default: auto-generated UUID)")
    args = parser.parse_args()

    # Validate input
    input_path = Path(args.input_file).resolve()
    if not input_path.exists():
        print(f"[✗] File not found: {input_path}")
        sys.exit(1)

    # Detect type
    input_type = detect_input_type(str(input_path))
    meeting_id = args.meeting_id or str(uuid.uuid4())[:8]

    # Output directory
    if args.output_dir:
        output_dir = Path(args.output_dir).resolve()
    else:
        output_dir = OUTPUT_DIR / meeting_id
    output_dir.mkdir(parents=True, exist_ok=True)

    # Override whisper model if specified
    if args.whisper_model:
        import config.settings as cfg
        cfg.WHISPER_MODEL = args.whisper_model

    # Run pipeline
    print(f"\n⚡ BOTZILLA — AI Meeting Summarizer")
    print(f"   Input:      {input_path.name}")
    print(f"   Type:       {input_type}")
    print(f"   Meeting ID: {meeting_id}")
    print(f"   Output:     {output_dir}")
    print(f"   Whisper:    {WHISPER_MODEL}")

    start = time.time()

    try:
        if input_type == "audio":
            summary = run_audio_pipeline(str(input_path), meeting_id, output_dir)
        else:
            summary = run_video_pipeline(str(input_path), meeting_id, output_dir)

        elapsed = time.time() - start
        print(f"\n{'='*60}")
        print(f"✅ BOTZILLA COMPLETE — {elapsed:.1f}s")
        print(f"   Output: {output_dir}")
        print(f"{'='*60}")

    except NotImplementedError as e:
        print(f"\n[✗] {e}")
        sys.exit(1)
    except Exception as e:
        elapsed = time.time() - start
        print(f"\n[✗] Pipeline failed after {elapsed:.1f}s: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
