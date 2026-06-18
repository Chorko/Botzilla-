"""
Botzilla — Cleaner (LLM Call #1)
Transforms Schema 1 (Raw Transcript) → Schema 2 (Cleaner Output)

What this does:
  1. Preprocessing (no LLM): merge same-speaker segments, remove filler-only, strip bloat
  2. LLM Call: Gemini 2.5 Flash with cleaner_prompt.txt
  3. Postprocessing: validate schema, compute slide_search_window, compute speaking stats

What the LLM does NOT do:
  - Compute speaking_time_seconds / speaking_percentage (done here)
  - Compute slide_search_window (done here from context timestamps)
  - Output "Speaker 1" as a placeholder — always null or resolved name
"""

import sys
import json
import time
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import google.generativeai as genai

from config.settings import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    SCHEMA_VERSION,
    SLIDE_WINDOW_PERCENTAGE,
    SLIDE_WINDOW_CAP_SECONDS,
    NAME_CONFIDENCE_THRESHOLD,
    load_prompt,
)


# ──────────────────────────────────────────────
# Gemini client setup
# ──────────────────────────────────────────────

def _get_gemini_client():
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not set in .env")
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        generation_config=genai.GenerationConfig(
            temperature=0.2,       # Low temp for structured JSON output
            response_mime_type="application/json",
        ),
    )


# ──────────────────────────────────────────────
# Preprocessing (before LLM call)
# ──────────────────────────────────────────────

def _preprocess_for_cleaner(schema1: dict) -> dict:
    """
    Strip bloat and prepare a lean input for the cleaner LLM.
    Per schema spec:
      - Strip `processing` and `audio_quality` blocks
      - Remove `is_filler_only = true` segments
      - Merge consecutive same-speaker segments
      - Send only: detection, segments (stripped of redundant fields)
    """
    segments = schema1.get("segments", [])

    # Remove filler-only segments
    segments = [s for s in segments if not s.get("is_filler_only", False)]

    # Merge consecutive same-speaker
    merged = []
    current = None
    for seg in segments:
        if current is None:
            current = dict(seg)
        elif seg["speaker_id"] == current["speaker_id"]:
            current["end_time"] = seg["end_time"]
            current["duration"] = round(current["end_time"] - current["start_time"], 3)
            current["text"] = current["text"].rstrip() + " " + seg["text"].lstrip()
            current["confidence"] = round((current["confidence"] + seg["confidence"]) / 2, 3)
            current["is_low_confidence"] = current["confidence"] < 0.70
            current["low_confidence_flags"] = list(
                set(current["low_confidence_flags"] + seg["low_confidence_flags"])
            )
        else:
            merged.append(current)
            current = dict(seg)
    if current:
        merged.append(current)

    # Build lean input — only what cleaner LLM needs
    return {
        "detection": schema1.get("detection", {}),
        "source": {
            "type": schema1["source"]["type"],
            "duration_seconds": schema1["source"]["duration_seconds"],
        },
        "segments": [
            {
                "segment_id": s["segment_id"],
                "speaker_id": s["speaker_id"],
                "start_time": s["start_time"],
                "end_time": s["end_time"],
                "pause_before_seconds": s["pause_before_seconds"],
                "text": s["text"],
                "language": s.get("language", "en"),
                "confidence": s["confidence"],
                "is_low_confidence": s["is_low_confidence"],
                "low_confidence_flags": s["low_confidence_flags"],
            }
            for s in merged
        ],
    }


# ──────────────────────────────────────────────
# Compute speaking stats (app layer, not LLM)
# ──────────────────────────────────────────────

def _compute_speaking_stats(schema1: dict, llm_speakers: list) -> list:
    """
    Compute speaking_time_seconds and speaking_percentage per speaker
    from the raw transcript segments. Passthrough to Schema 2 speakers array.
    """
    total_duration = schema1["source"]["duration_seconds"]
    time_by_speaker = {}

    for seg in schema1.get("segments", []):
        sid = seg["speaker_id"]
        dur = seg["end_time"] - seg["start_time"]
        time_by_speaker[sid] = time_by_speaker.get(sid, 0.0) + dur

    total_speaking = sum(time_by_speaker.values())

    enriched = []
    for speaker in llm_speakers:
        sid = speaker["speaker_id"]
        speaking_time = round(time_by_speaker.get(sid, 0.0), 2)
        speaking_pct = round((speaking_time / total_speaking * 100) if total_speaking > 0 else 0.0, 1)

        enriched.append({
            **speaker,
            "speaking_time_seconds": speaking_time,
            "speaking_percentage": speaking_pct,
        })

    return enriched


# ──────────────────────────────────────────────
# Compute slide search windows (app layer)
# ──────────────────────────────────────────────

def _enrich_slide_windows(contexts: list) -> list:
    """
    Compute slide_search_window for each context using the locked formula:
      window_seconds = min(duration_seconds * 0.05, 180)
      search_from = max(0, start_time - window_seconds)
      search_to = start_time + window_seconds
    """
    enriched = []
    for ctx in contexts:
        duration = ctx.get("duration_seconds", 0)
        start = ctx.get("start_time", 0)

        window_pct = duration * SLIDE_WINDOW_PERCENTAGE
        window_sec = min(window_pct, SLIDE_WINDOW_CAP_SECONDS)
        method = "capped" if window_pct > SLIDE_WINDOW_CAP_SECONDS else "percentage"

        enriched.append({
            **ctx,
            "slide_search_window": {
                "window_seconds": round(window_sec, 3),
                "method": method,
                "search_from": round(max(0.0, start - window_sec), 3),
                "search_to": round(start + window_sec, 3),
            },
        })
    return enriched


# ──────────────────────────────────────────────
# Schema 2 validator
# ──────────────────────────────────────────────

def _validate_and_fix_schema2(llm_output: dict, schema1: dict) -> dict:
    """
    Validate LLM output and enforce schema rules:
      - inferred_name must be null when confidence < 0.65 or source = "unresolved"
      - speaker_id format must be SPEAKER_XX
      - contexts ordered by start_time
    """
    speakers = llm_output.get("speakers", [])
    for sp in speakers:
        conf = sp.get("name_confidence", 0.0)
        source = sp.get("name_source", "unresolved")

        # Enforce null rule
        if conf < NAME_CONFIDENCE_THRESHOLD or source == "unresolved":
            sp["inferred_name"] = None
            sp["name_confidence"] = 0.0 if source == "unresolved" else conf

        # Ensure SPEAKER_XX format
        sid = sp.get("speaker_id", "")
        if not sid.startswith("SPEAKER_"):
            # Attempt to normalize e.g. "speaker_0" → "SPEAKER_00"
            num = "".join(filter(str.isdigit, sid)).zfill(2)
            sp["speaker_id"] = f"SPEAKER_{num}"

    # Sort contexts by start_time
    contexts = llm_output.get("contexts", [])
    contexts.sort(key=lambda c: c.get("start_time", 0))
    for i, ctx in enumerate(contexts):
        ctx["index"] = i

    return llm_output


# ──────────────────────────────────────────────
# Main clean function
# ──────────────────────────────────────────────

def clean_transcript(schema1: dict) -> dict:
    """
    LLM Call #1: Transform Schema 1 → Schema 2.

    Args:
        schema1: Raw transcript dict conforming to Schema 1

    Returns:
        Cleaner output dict conforming to Schema 2
    """
    cleaned_id = str(uuid.uuid4())
    t_start = time.time()

    print(f"[cleaner] Preprocessing transcript for LLM...")
    lean_input = _preprocess_for_cleaner(schema1)
    segment_count_in = len(lean_input["segments"])
    print(f"[cleaner] Sending {segment_count_in} segments to Gemini...")

    # Load prompt
    system_prompt = load_prompt("cleaner_prompt.txt")
    user_message = json.dumps(lean_input, ensure_ascii=False)

    # LLM Call #1
    model = _get_gemini_client()
    response = model.generate_content(
        contents=[
            {"role": "user", "parts": [
                f"SYSTEM INSTRUCTIONS:\n{system_prompt}\n\n"
                f"TRANSCRIPT INPUT:\n{user_message}"
            ]}
        ]
    )

    t_llm = time.time() - t_start
    print(f"[cleaner] LLM response received in {t_llm:.1f}s")

    # Parse JSON response
    try:
        llm_output = json.loads(response.text)
    except json.JSONDecodeError as e:
        # Try to extract JSON from response if wrapped in markdown
        text = response.text
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        try:
            llm_output = json.loads(text)
        except json.JSONDecodeError:
            raise ValueError(f"Cleaner LLM returned invalid JSON: {e}\n\nRaw: {response.text[:500]}")

    # Validate and enforce schema rules
    llm_output = _validate_and_fix_schema2(llm_output, schema1)

    # App layer: compute speaking stats (not LLM job)
    llm_output["speakers"] = _compute_speaking_stats(schema1, llm_output.get("speakers", []))

    # App layer: compute slide search windows
    llm_output["contexts"] = _enrich_slide_windows(llm_output.get("contexts", []))

    # Build final Schema 2 envelope
    total_duration = schema1["source"]["duration_seconds"]
    meeting = llm_output.get("meeting", {})

    schema2 = {
        "cleaned_id": cleaned_id,
        "schema_version": SCHEMA_VERSION,
        "source_transcript_id": schema1["transcript_id"],
        "source_type": schema1["source"]["type"],
        "llm_model": GEMINI_MODEL,
        "processed_at": datetime.now(timezone.utc).isoformat(),
        "meeting": {
            **meeting,
            "duration_seconds": total_duration,
            "language_primary": schema1["detection"].get("language_primary", "en"),
            "is_multilingual": schema1["detection"].get("is_multilingual", False),
        },
        "speakers": llm_output.get("speakers", []),
        "contexts": llm_output.get("contexts", []),
        "cleaning_stats": llm_output.get("cleaning_stats", {
            "original_segment_count": len(schema1.get("segments", [])),
            "final_segment_count": segment_count_in,
            "total_merged": 0,
            "total_removed": 0,
            "names_resolved": 0,
            "names_unresolved": 0,
            "contexts_detected": len(llm_output.get("contexts", [])),
            "low_confidence_segments_handled": 0,
        }),
        "removed_segments": llm_output.get("removed_segments", []),
        "llm_notes": llm_output.get("llm_notes", ""),
    }

    elapsed = time.time() - t_start
    print(f"[cleaner] Done in {elapsed:.1f}s — {len(schema2.get('contexts', []))} contexts detected")
    for ctx in schema2.get("contexts", []):
        print(f"  [{ctx.get('start_time', 0):.1f}s - {ctx.get('end_time', 0):.1f}s] {ctx.get('topic', 'Unknown')}")

    return schema2


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Botzilla Cleaner — Schema 1 → Schema 2")
    parser.add_argument("raw_json", help="Path to Schema 1 JSON (output of audio_engine)")
    parser.add_argument("output_dir", help="Directory to save cleaned transcript JSON")
    args = parser.parse_args()

    with open(args.raw_json, encoding="utf-8") as f:
        schema1 = json.load(f)

    schema2 = clean_transcript(schema1)

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{schema2['source_transcript_id'][:8]}_cleaned.json"

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(schema2, f, indent=2, ensure_ascii=False)

    print(f"\n[✓] Schema 2 saved: {out_path}")
