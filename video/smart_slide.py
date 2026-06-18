"""
Botzilla — Smart Slide Selector
Context-aware frame selection using Cleaner Output (Schema 2) timestamps.

For each context boundary in the cleaner output:
  1. Compute slide_search_window (already in Schema 2, but recalculated here for safety)
  2. Find all frames within [start - window, start + window]
  3. Score each candidate frame: sharpness + text_density + ocr_confidence
  4. Pick best non-duplicate frame per context
  5. Return slides[] block ready for Schema 3

Formula (locked):
  window_seconds = min(context_duration * 0.05, 180)
  search_from = max(0, context_start - window_seconds)
  search_to = context_start + window_seconds
"""

import sys
import uuid
from pathlib import Path
from typing import List, Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import (
    SLIDE_WINDOW_PERCENTAGE,
    SLIDE_WINDOW_CAP_SECONDS,
)


# ──────────────────────────────────────────────
# Scoring
# ──────────────────────────────────────────────

def _score_frame(frame: dict) -> float:
    """
    Composite relevance score for a frame candidate.
    Weights:
      - sharpness_score   : 0.40  (blurry frames are useless)
      - text_density      : 0.35  (slides have lots of text)
      - ocr_confidence    : 0.25  (readable text > unreadable)

    Returns score in [0.0, 1.0]
    """
    sharpness = frame.get("sharpness_score", 0.0)
    density   = frame.get("text_density", 0.0)
    ocr_conf  = frame.get("ocr_confidence", 0.0)

    # Penalise frames with no text at all (likely transitional/gameplay/face shots)
    if density < 0.01:
        return sharpness * 0.2  # very low relevance

    return (sharpness * 0.40) + (density * 0.35) + (ocr_conf * 0.25)


def _compute_window(start_time: float, duration: float) -> tuple:
    """
    Compute slide search window bounds.
    Returns (search_from, search_to, window_seconds, method)
    """
    window_pct = duration * SLIDE_WINDOW_PERCENTAGE
    window_sec = min(window_pct, SLIDE_WINDOW_CAP_SECONDS)
    method = "capped" if window_pct > SLIDE_WINDOW_CAP_SECONDS else "percentage"
    search_from = max(0.0, start_time - window_sec)
    search_to   = start_time + window_sec
    return search_from, search_to, round(window_sec, 3), method


# ──────────────────────────────────────────────
# Main selector
# ──────────────────────────────────────────────

def select_slides(
    schema2: dict,
    ocr_frames: List[dict],
    slides_storage_base: str,
    meeting_id: str = None,
) -> List[dict]:
    """
    Select the best frame per context boundary and build the slides[] block
    for Schema 3.

    Args:
        schema2: Cleaner Output (Schema 2) dict — provides context boundaries
        ocr_frames: List of OCR-enriched frame dicts from ocr_processor.process_frames()
                    Each has: path, timestamp, ocr_text, ocr_confidence,
                              sharpness_score, text_density, is_duplicate
        slides_storage_base: Base path for storing selected slide images
                             (e.g. "output/{meeting_id}/slides")
        meeting_id: Optional ID used to build storage paths

    Returns:
        slides[] array ready to be injected into Schema 3 Block 8
    """
    if not ocr_frames:
        return []

    contexts = schema2.get("contexts", [])
    if not contexts:
        return []

    storage_base = Path(slides_storage_base)
    storage_base.mkdir(parents=True, exist_ok=True)

    # Index frames by timestamp for fast lookup
    # Sort ascending by timestamp
    sorted_frames = sorted(ocr_frames, key=lambda f: f["timestamp"])

    slides = []
    used_frame_paths = set()  # Prevent same frame selected for multiple contexts

    for ctx in contexts:
        ctx_id      = ctx.get("context_id", f"ctx_{ctx.get('index', 0):03d}")
        start_time  = ctx.get("start_time", 0.0)
        duration    = ctx.get("duration_seconds", 0.0)

        # Use pre-computed window if present, else recalculate
        if "slide_search_window" in ctx:
            sw = ctx["slide_search_window"]
            search_from = sw.get("search_from", 0.0)
            search_to   = sw.get("search_to", start_time + 30)
            window_sec  = sw.get("window_seconds", 30)
            method      = sw.get("method", "percentage")
        else:
            search_from, search_to, window_sec, method = _compute_window(start_time, duration)

        # Find candidate frames within the search window
        candidates = [
            f for f in sorted_frames
            if search_from <= f["timestamp"] <= search_to
            and not f.get("is_duplicate", False)
            and f.get("path") not in used_frame_paths
        ]

        if not candidates:
            # Widen search to 2× window — take nearest unused frame within reasonable distance.
            # No unlimited fallback: a frame from the wrong section of the video is worse than no slide.
            max_fallback_distance = window_sec * 2
            nearest = min(
                (f for f in sorted_frames
                 if f.get("path") not in used_frame_paths
                 and abs(f["timestamp"] - start_time) <= max_fallback_distance),
                key=lambda f: abs(f["timestamp"] - start_time),
                default=None,
            )
            if nearest:
                candidates = [nearest]

        if not candidates:
            continue

        # Score candidates and pick best
        best = max(candidates, key=_score_frame)

        # Skip frames with essentially no content
        if _score_frame(best) < 0.05:
            continue

        # Build storage path for this slide
        slide_id  = f"slide_{len(slides)+1:02d}"
        src_path  = Path(best["path"])
        dest_name = f"{ctx_id}_{slide_id}{src_path.suffix}"
        dest_path = storage_base / dest_name

        # Copy frame to slides storage
        try:
            import shutil
            shutil.copy2(str(src_path), str(dest_path))
            used_frame_paths.add(best["path"])
        except Exception as e:
            print(f"[smart_slide] Warning: could not copy {src_path.name}: {e}")
            continue

        # Build Schema 3 slide object
        slides.append({
            "slide_id": slide_id,
            "topic_id": ctx_id,
            "timestamp": best["timestamp"],
            "image_path": str(dest_path),
            "ocr_text": best.get("ocr_text", ""),
            "ocr_confidence": best.get("ocr_confidence", 0.0),
            "sharpness_score": best.get("sharpness_score", 0.0),
            "text_density": best.get("text_density", 0.0),
            "relevance_score": round(_score_frame(best), 4),
            "extraction_method": "context_boundary",
            "search_window": {
                "window_seconds": window_sec,
                "method": method,
                "search_from": round(search_from, 3),
                "search_to": round(search_to, 3),
            },
        })

        print(
            f"[smart_slide] {ctx_id}: {Path(dest_name).name} "
            f"@ {best['timestamp']:.1f}s "
            f"(score: {_score_frame(best):.3f})"
        )

    print(f"[smart_slide] Selected {len(slides)} slides from {len(contexts)} contexts")
    return slides


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────

if __name__ == "__main__":
    import argparse, json

    parser = argparse.ArgumentParser(
        description="Botzilla Smart Slide Selector — picks best frame per context"
    )
    parser.add_argument("cleaned_json",  help="Path to Schema 2 (cleaner output) JSON")
    parser.add_argument("ocr_json",      help="Path to OCR frames JSON (from ocr_processor)")
    parser.add_argument("slides_dir",    help="Directory to save selected slide images")
    parser.add_argument("output_json",   help="Output path for slides[] JSON block")
    args = parser.parse_args()

    with open(args.cleaned_json, encoding="utf-8") as f:
        schema2 = json.load(f)
    with open(args.ocr_json, encoding="utf-8") as f:
        ocr_frames = json.load(f)

    slides = select_slides(schema2, ocr_frames, args.slides_dir)

    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(slides, f, indent=2, ensure_ascii=False)

    print(f"[✓] {len(slides)} slides written to: {args.output_json}")
