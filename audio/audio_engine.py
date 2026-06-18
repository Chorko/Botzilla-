"""
Botzilla — Audio Engine (Schema 1 Output)
WhisperX large-v3 transcription + pyannote 3.1 speaker diarization.

Outputs Schema 1 JSON (Raw Transcript) — see docs/schemas.md

Usage:
    python -m audio.audio_engine <audio_file> <output_dir> [--meeting-id <id>]

Key design decisions:
  - Segment-level timestamps only (not word-level) — see schemas.md for rationale
  - Audio pre-processed to 16kHz WAV before passing to WhisperX
  - pause_before_seconds computed per segment — signal to Cleaner for context switches
  - is_filler_only, is_low_confidence, low_confidence_flags computed here
  - No LLM calls in this stage — pure transcription + diarization
"""

import sys
import os
import json
import time
import uuid
import argparse
from pathlib import Path
from datetime import datetime, timezone

# Add project root to path when run as module
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import torch
import whisperx

from config.settings import (
    HF_TOKEN,
    WHISPER_MODEL,
    WHISPER_BATCH_SIZE,
    WHISPER_COMPUTE_TYPE,
    DIARIZATION_MODEL,
    MIN_SPEAKERS,
    MAX_SPEAKERS,
    LOW_CONFIDENCE_THRESHOLD,
    VERY_SHORT_SEGMENT_THRESHOLD,
    FILLER_WORDS,
    SCHEMA_VERSION,
)
from audio.preprocessor import convert_to_wav, get_audio_duration, get_file_size


# ──────────────────────────────────────────────
# Model singletons — loaded once, reused across requests
# ──────────────────────────────────────────────

# WhisperX model cache: keyed by (model_name, device) so switching models still works
_whisper_cache: dict = {}
_diarize_cache: dict = {}
_align_cache:   dict = {}   # keyed by (language_code, device)


def _get_whisper_model(model_name: str, device: str, compute_type: str):
    """Return a cached WhisperX model, loading it on first call."""
    key = (model_name, device)
    if key not in _whisper_cache:
        print(f"[audio_engine] Loading WhisperX {model_name} ({device}) — one-time startup...")
        _whisper_cache[key] = whisperx.load_model(model_name, device, compute_type=compute_type, language=None)
        print(f"[audio_engine] Model loaded and cached.")
    return _whisper_cache[key]


def _get_align_model(language_code: str, device: str):
    """Return a cached WhisperX align model (language-specific), loading it on first call."""
    key = (language_code, device)
    if key not in _align_cache:
        print(f"[audio_engine] Loading align model for '{language_code}' ({device})...")
        _align_cache[key] = whisperx.load_align_model(language_code=language_code, device=device)
        print(f"[audio_engine] Align model cached.")
    return _align_cache[key]


def _get_diarize_pipeline(token: str, device: str):
    """Return a cached Pyannote diarization pipeline, loading it on first call."""
    # Key includes a hash of the token so token rotation forces a reload
    key = (device, token[:8] if token else "")
    if key not in _diarize_cache:
        print(f"[audio_engine] Loading Pyannote diarization pipeline ({device}) — one-time startup...")
        _diarize_cache[key] = whisperx.diarize.DiarizationPipeline(token=token, device=device)
        print(f"[audio_engine] Diarization pipeline cached.")
    return _diarize_cache[key]


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def compute_audio_quality(segments: list, total_duration: float) -> dict:
    """Estimate audio quality metrics from segment data."""
    if not segments:
        return {
            "quality_rating": "poor",
            "snr_db": None,
            "has_background_noise": False,
            "has_music": False,
            "has_crosstalk": False,
            "avg_silence_ratio": 1.0,
        }

    # Speaking time = sum of all segment durations
    speaking_time = sum(
        s.get("end_time", 0) - s.get("start_time", 0)
        for s in segments
    )
    silence_ratio = max(0.0, 1.0 - (speaking_time / total_duration)) if total_duration > 0 else 0.0

    # Check for overlapping segments (potential crosstalk)
    has_crosstalk = False
    sorted_segs = sorted(segments, key=lambda s: s["start_time"])
    for i in range(len(sorted_segs) - 1):
        if sorted_segs[i]["end_time"] > sorted_segs[i + 1]["start_time"] + 0.1:
            has_crosstalk = True
            break

    # Average confidence
    confidences = [s["confidence"] for s in segments if s["confidence"] is not None]
    avg_conf = sum(confidences) / len(confidences) if confidences else 0.0

    if avg_conf >= 0.85:
        quality = "good"
    elif avg_conf >= 0.65:
        quality = "fair"
    else:
        quality = "poor"

    return {
        "quality_rating": quality,
        "snr_db": None,          # Would need signal analysis library for true SNR
        "has_background_noise": avg_conf < 0.70,
        "has_music": False,      # Not detectable from transcript alone
        "has_crosstalk": has_crosstalk,
        "avg_silence_ratio": round(silence_ratio, 3),
    }


def detect_filler_only(text: str) -> bool:
    """Return True if the segment contains nothing but filler words."""
    words = set(text.lower().replace(",", "").replace(".", "").split())
    return bool(words) and words.issubset(FILLER_WORDS)


def get_low_confidence_flags(segment: dict, confidence: float) -> list:
    """Compute low_confidence_flags for a segment."""
    flags = []
    text = segment.get("text", "")
    duration = segment.get("end_time", 0) - segment.get("start_time", 0)

    if confidence < LOW_CONFIDENCE_THRESHOLD:
        # Check why confidence is low
        words = text.lower().split()
        filler_count = sum(1 for w in words if w.strip(",.?!") in FILLER_WORDS)
        if words and filler_count / len(words) > 0.5:
            flags.append("filler_heavy")

    if duration < VERY_SHORT_SEGMENT_THRESHOLD:
        flags.append("very_short")

    # Language switching detection (basic heuristic)
    hindi_chars = set("अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह")
    if any(c in hindi_chars for c in text):
        flags.append("code_switch")

    return flags


def merge_same_speaker_whisper_segments(raw_segments: list) -> list:
    """
    Merge consecutive same-speaker segments from WhisperX output.
    WhisperX may split a single utterance into many small pieces.
    We merge them here BEFORE computing pause_before_seconds.
    """
    merged = []
    current = None

    for seg in raw_segments:
        if not seg.get("speaker"):
            continue

        if current is None:
            current = {
                "speaker": seg["speaker"],
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"].strip(),
                "avg_confidence": seg.get("avg_logprob", 0),
                "no_speech_prob": seg.get("no_speech_prob", 0),
            }
        elif seg["speaker"] == current["speaker"]:
            # Same speaker — extend
            current["end"] = seg["end"]
            current["text"] += " " + seg["text"].strip()
            current["avg_confidence"] = (current["avg_confidence"] + seg.get("avg_logprob", 0)) / 2
        else:
            merged.append(current)
            current = {
                "speaker": seg["speaker"],
                "start": seg["start"],
                "end": seg["end"],
                "text": seg["text"].strip(),
                "avg_confidence": seg.get("avg_logprob", 0),
                "no_speech_prob": seg.get("no_speech_prob", 0),
            }

    if current:
        merged.append(current)

    return merged


# ──────────────────────────────────────────────
# Schema 1 builder
# ──────────────────────────────────────────────

def build_schema1(
    transcript_id: str,
    source_path: str,
    source_type: str,
    extracted_audio_path: str,
    total_duration: float,
    file_size: int,
    processing_time: float,
    whisper_model_name: str,
    language: str,
    language_confidence: float,
    speaker_count: int,
    diarization_confidence: float,
    merged_segments: list,
) -> dict:
    """
    Construct the complete Schema 1 JSON from pipeline outputs.
    """
    source_path = Path(source_path)
    segments_out = []
    prev_end_time = 0.0

    # Detect additional languages (basic heuristic)
    languages_detected = [language]
    hindi_chars = set("अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह")
    any_hindi = any(
        c in hindi_chars
        for seg in merged_segments
        for c in seg.get("text", "")
    )
    if any_hindi and "hi" not in languages_detected:
        languages_detected.append("hi")
    is_multilingual = len(languages_detected) > 1

    for i, seg in enumerate(merged_segments):
        start_time = seg.get("start", prev_end_time)
        end_time = seg.get("end", start_time + 1.0)
        text = seg["text"].strip()
        speaker_id = seg["speaker"]  # Always SPEAKER_XX format from pyannote

        # WhisperX avg_logprob is typically in range [-1, 0]; normalize to [0, 1]
        raw_logprob = seg.get("avg_confidence", -0.3)
        confidence = round(max(0.0, min(1.0, 1.0 + raw_logprob)), 3)

        is_low_conf = confidence < LOW_CONFIDENCE_THRESHOLD
        flags = get_low_confidence_flags(
            {"text": text, "start_time": start_time, "end_time": end_time},
            confidence,
        )

        # Language detection per segment
        seg_lang = "hi" if any(c in hindi_chars for c in text) else language

        # Code switch flag
        if seg_lang != language and "code_switch" not in flags:
            flags.append("code_switch")

        # Pause before this segment
        pause_before = max(0.0, round(start_time - prev_end_time, 3))
        prev_end_time = end_time

        is_filler = detect_filler_only(text)

        segments_out.append({
            "segment_id": f"seg_{i+1:03d}",
            "speaker_id": speaker_id,
            "start_time": round(start_time, 3),
            "end_time": round(end_time, 3),
            "duration": round(end_time - start_time, 3),
            "pause_before_seconds": pause_before,
            "text": text,
            "language": seg_lang,
            "confidence": confidence,
            "is_low_confidence": is_low_conf,
            "low_confidence_flags": flags,
            "has_overlap": False,       # Set True if overlap detection implemented
            "is_filler_only": is_filler,
        })

    audio_quality = compute_audio_quality(segments_out, total_duration)

    return {
        "transcript_id": transcript_id,
        "schema_version": SCHEMA_VERSION,
        "source": {
            "type": source_type,
            "filename": source_path.name,
            "format": source_path.suffix.lstrip("."),
            "duration_seconds": round(total_duration, 3),
            "file_size_bytes": file_size,
            "extracted_audio_path": extracted_audio_path,
        },
        "processing": {
            "engine": "whisperx",
            "whisper_model": whisper_model_name,
            "diarization_model": DIARIZATION_MODEL,
            "processed_at": datetime.now(timezone.utc).isoformat(),
            "processing_time_seconds": round(processing_time, 2),
        },
        "detection": {
            "language_primary": language,
            "language_confidence": round(language_confidence, 3),
            "is_multilingual": is_multilingual,
            "languages_detected": languages_detected,
            "speaker_count_detected": speaker_count,
            "diarization_confidence": round(diarization_confidence, 3),
        },
        "audio_quality": audio_quality,
        "segments": segments_out,
    }


# ──────────────────────────────────────────────
# Main pipeline function
# ──────────────────────────────────────────────

def process_audio(
    input_path: str,
    meeting_id: str = None,
    source_type: str = "audio",
    extracted_audio_path: str = None,
) -> dict:
    """
    Run WhisperX transcription + pyannote diarization on an audio file.
    Returns Schema 1 JSON dict.

    Args:
        input_path: Path to audio file (any format — will be converted to WAV)
        meeting_id: Optional ID for this processing run
        source_type: "audio" or "video"
        extracted_audio_path: For video pipeline — the extracted audio track path
    """
    if meeting_id is None:
        meeting_id = str(uuid.uuid4())[:8]

    input_path = str(Path(input_path).resolve())
    transcript_id = str(uuid.uuid4())
    t_start = time.time()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute_type = WHISPER_COMPUTE_TYPE if device == "cuda" else "int8"

    print(f"[audio_engine] Device: {device}")
    print(f"[audio_engine] WhisperX model: {WHISPER_MODEL}")
    print(f"[audio_engine] Input: {Path(input_path).name}")

    file_size = get_file_size(input_path)

    # ── Step 1: Preprocess — convert to 16kHz WAV ──
    # If the video pipeline already extracted a 16kHz WAV, skip re-conversion.
    if extracted_audio_path and Path(extracted_audio_path).exists():
        wav_path = str(Path(extracted_audio_path).resolve())
        print(f"[audio_engine] Step 1/4: Using pre-extracted audio: {Path(wav_path).name}")
    else:
        print("[audio_engine] Step 1/4: Converting audio to 16kHz WAV...")
        wav_path = convert_to_wav(input_path)
    total_duration = get_audio_duration(wav_path)
    print(f"[audio_engine] Duration: {total_duration:.1f}s ({total_duration/60:.1f} min)")

    # ── Step 2: Transcribe with WhisperX ──
    print(f"[audio_engine] Step 2/4: Transcribing with WhisperX ({WHISPER_MODEL})...")
    model = _get_whisper_model(WHISPER_MODEL, device, compute_type)
    audio = whisperx.load_audio(wav_path)
    result = model.transcribe(audio, batch_size=WHISPER_BATCH_SIZE)

    language = result.get("language", "en")
    language_confidence = result.get("language_probability", 1.0)
    print(f"[audio_engine] Detected language: {language} (confidence: {language_confidence:.2f})")

    # ── Step 3: Align (word timestamps, but we only use segment-level) ──
    print("[audio_engine] Step 3/4: Aligning transcription...")
    align_model, align_metadata = _get_align_model(language, device)
    result = whisperx.align(
        result["segments"],
        align_model,
        align_metadata,
        audio,
        device,
        return_char_alignments=False,  # Segment-level only — word-level not serialized
    )

    # ── Step 4: Diarize with pyannote ──
    print("[audio_engine] Step 4/4: Speaker diarization (pyannote 3.1)...")
    if not HF_TOKEN:
        raise ValueError(
            "HF_TOKEN is required for pyannote diarization.\n"
            "Accept model licenses at:\n"
            "  https://huggingface.co/pyannote/speaker-diarization-3.1\n"
            "  https://huggingface.co/pyannote/segmentation-3.0\n"
            "Then add HF_TOKEN to .env"
        )

    diarize_pipeline = _get_diarize_pipeline(HF_TOKEN, device)
    diarize_result = diarize_pipeline(
        audio,
        min_speakers=MIN_SPEAKERS,
        max_speakers=MAX_SPEAKERS,
    )
    result = whisperx.assign_word_speakers(diarize_result, result)

    # Get speaker count and rough diarization confidence
    raw_segments = [s for s in result["segments"] if s.get("speaker")]
    speakers_found = list({s["speaker"] for s in raw_segments})
    speaker_count = len(speakers_found)
    diarization_confidence = 0.85  # pyannote doesn't expose a single score; use reasonable default

    print(f"[audio_engine] Detected {speaker_count} speakers: {', '.join(sorted(speakers_found))}")

    # ── Step 5: Merge same-speaker segments + build Schema 1 ──
    merged = merge_same_speaker_whisper_segments(raw_segments)
    t_end = time.time()
    processing_time = t_end - t_start

    schema1 = build_schema1(
        transcript_id=transcript_id,
        source_path=input_path,
        source_type=source_type,
        extracted_audio_path=extracted_audio_path,
        total_duration=total_duration,
        file_size=file_size,
        processing_time=processing_time,
        whisper_model_name=WHISPER_MODEL,
        language=language,
        language_confidence=language_confidence,
        speaker_count=speaker_count,
        diarization_confidence=diarization_confidence,
        merged_segments=merged,
    )

    # Print raw diarization summary
    print(f"\n--- [DIARIZATION SUMMARY] ---")
    for seg in schema1["segments"]:
        print(
            f"  [{seg['start_time']:.2f}s - {seg['end_time']:.2f}s] "
            f"{seg['speaker_id']}: {seg['text'][:80]}..."
            if len(seg['text']) > 80 else
            f"  [{seg['start_time']:.2f}s - {seg['end_time']:.2f}s] "
            f"{seg['speaker_id']}: {seg['text']}"
        )
    print(f"-----------------------------")
    print(f"[audio_engine] Done in {processing_time:.1f}s — {len(schema1['segments'])} segments")

    # Cleanup temp WAV if it was created
    if wav_path != input_path:
        try:
            os.remove(wav_path)
        except Exception:
            pass

    return schema1


# ──────────────────────────────────────────────
# CLI entrypoint
# ──────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Botzilla Audio Engine — outputs Schema 1 JSON")
    parser.add_argument("input_file", help="Path to audio file")
    parser.add_argument("output_dir", help="Directory to save raw transcript JSON")
    parser.add_argument("--meeting-id", default=None, help="Custom meeting ID")
    parser.add_argument("--whisper-model", default=None, help="Override WhisperX model")
    args = parser.parse_args()

    if args.whisper_model:
        import config.settings as cfg
        cfg.WHISPER_MODEL = args.whisper_model

    meeting_id = args.meeting_id or str(uuid.uuid4())[:8]
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    schema1 = process_audio(args.input_file, meeting_id)

    out_path = output_dir / f"{meeting_id}_raw.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(schema1, f, indent=2, ensure_ascii=False)

    print(f"\n[✓] Schema 1 saved: {out_path}")
