"""
Botzilla — OCR Processor
Runs EasyOCR on individual extracted frames and produces per-frame metadata.

Key improvements over ApplicationCodeFile/ocr_processor.py:
  - Works on individual frames (not a stitched grid image)
  - Returns structured dict instead of writing files directly
  - Fuzzy dedup with configurable threshold
  - Laplacian sharpness score per frame
  - Text density calculation
"""

import os
import json
import numpy as np
from pathlib import Path
from typing import List, Optional

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import (
    OCR_LANGUAGES,
    OCR_SIMILARITY_THRESHOLD,
    FRAME_WIDTH,
    FRAME_HEIGHT,
)


# ──────────────────────────────────────────────
# Lazy EasyOCR loader
# ──────────────────────────────────────────────

_reader = None

def _get_reader():
    global _reader
    if _reader is None:
        import easyocr
        from config.settings import _HAS_GPU
        _reader = easyocr.Reader(OCR_LANGUAGES, gpu=_HAS_GPU)
        print(f"[ocr_processor] EasyOCR initialized (gpu={'yes' if _HAS_GPU else 'no'})")
    return _reader


# ──────────────────────────────────────────────
# Frame scoring
# ──────────────────────────────────────────────

def _laplacian_sharpness(gray_array: np.ndarray) -> float:
    """
    Compute Laplacian variance as a sharpness score.
    Higher = sharper frame. Normalized to [0, 1] range (capped at 2000 var).
    """
    import cv2
    lap_var = cv2.Laplacian(gray_array, cv2.CV_64F).var()
    return round(min(1.0, float(lap_var) / 2000.0), 4)


def _text_density(gray_array: np.ndarray) -> float:
    """
    Estimate text density as the fraction of pixels with edge activity
    (Canny edges as a proxy for text lines).
    """
    import cv2
    edges = cv2.Canny(gray_array, 50, 150)
    total_pixels = gray_array.shape[0] * gray_array.shape[1]
    edge_pixels = int(cv2.countNonZero(edges))
    return round(edge_pixels / total_pixels, 4)


def _fuzzy_similar(text_a: str, text_b: str, threshold: float) -> bool:
    """Return True if two texts are fuzzy-similar above the threshold."""
    if not text_a or not text_b:
        return False
    try:
        from rapidfuzz import fuzz
        return fuzz.ratio(text_a, text_b) > threshold
    except ImportError:
        # Fallback: simple character overlap
        a, b = set(text_a.lower()), set(text_b.lower())
        overlap = len(a & b) / max(len(a | b), 1)
        return overlap > (threshold / 100.0)


# ──────────────────────────────────────────────
# Single frame processor
# ──────────────────────────────────────────────

def process_frame(frame_path: str, timestamp: float, fast_mode: bool = False) -> dict:
    """
    Run OCR on a single frame image.

    Returns:
        dict with: path, timestamp, ocr_text, ocr_confidence,
                   sharpness_score, text_density, is_duplicate (initially False)
    """
    import cv2
    from PIL import Image

    frame_path = str(frame_path)
    result = {
        "path": frame_path,
        "timestamp": round(timestamp, 3),
        "ocr_text": "",
        "ocr_confidence": 0.0,
        "sharpness_score": 0.0,
        "text_density": 0.0,
        "is_duplicate": False,
    }

    try:
        # Load image
        img = cv2.imread(frame_path)
        if img is None:
            return result

        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Score the frame
        result["sharpness_score"] = _laplacian_sharpness(gray)
        result["text_density"] = _text_density(gray)

        if fast_mode:
            result["_thumb"] = cv2.resize(gray, (16, 16), interpolation=cv2.INTER_AREA)
            return result

        from config.settings import _HAS_GPU

        # 2× upscale for OCR accuracy on small text (only if GPU is available, otherwise too slow)
        if _HAS_GPU:
            h, w = gray.shape
            img_to_ocr = cv2.resize(gray, (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4)
        else:
            img_to_ocr = gray

        reader = _get_reader()

        # Single pass to extract both text and confidence
        # detail=1 returns (bbox, text, conf) tuples
        detail_result = reader.readtext(img_to_ocr, detail=1, paragraph=False)

        texts = []
        confidences = []
        for det in detail_result:
            if len(det) >= 3:
                text = det[1].strip()
                if text:
                    texts.append(text)
                    confidences.append(float(det[2]))

        result["ocr_text"] = "\n".join(texts)
        result["ocr_confidence"] = round(
            sum(confidences) / len(confidences) if confidences else 0.0, 3
        )

    except Exception as e:
        print(f"[ocr_processor] Error on {Path(frame_path).name}: {e}")

    return result


# ──────────────────────────────────────────────
# Phase 1: Fast scoring (no OCR)
# ──────────────────────────────────────────────

def score_frames(frames: List[dict]) -> List[dict]:
    """
    Fast first-pass over ALL extracted frames.
    Computes sharpness + text_density using cv2 only (no EasyOCR).
    Uses 16x16 thumbnail MSE for visual duplicate detection instead of
    slow text fuzzy matching — ~100x faster than the old process_frames.

    Args:
        frames: list of {"path": ..., "timestamp": ...} dicts

    Returns:
        List of scored frame dicts (no ocr_text yet — that comes in phase 2)
    """
    import cv2
    print(f"[ocr_processor] Fast-scoring {len(frames)} frames (no OCR)...")
    results = []
    last_thumb = None

    for frame in frames:
        path = frame.get("path", "")
        ts   = frame.get("timestamp", 0.0)

        res = process_frame(path, ts, fast_mode=True)

        # Visual MSE dedup via 16x16 thumbnail comparison
        if last_thumb is not None and "_thumb" in res:
            mse = float(((res["_thumb"].astype("float") - last_thumb.astype("float")) ** 2).mean())
            if mse < 15.0:   # Nearly identical frame — same slide still on screen
                res["is_duplicate"] = True

        if not res.get("is_duplicate") and "_thumb" in res:
            last_thumb = res["_thumb"]

        res.pop("_thumb", None)  # Don't serialise numpy arrays
        results.append(res)

    non_dup = sum(1 for r in results if not r["is_duplicate"])
    print(f"[ocr_processor] Scored {len(results)} frames — {non_dup} visually unique.")
    return results


# ──────────────────────────────────────────────
# Phase 2: OCR on selection only
# ──────────────────────────────────────────────

def ocr_selected_slides(slides: List[dict]) -> List[dict]:
    """
    Run EasyOCR on only the final selected slides (typically 5-15).
    Fills in ocr_text and ocr_confidence on each slide in-place.

    Args:
        slides: slides[] list returned by smart_slide.select_slides()

    Returns:
        Same list with ocr_text and ocr_confidence populated.
    """
    if not slides:
        return slides

    print(f"[ocr_processor] Running OCR on {len(slides)} selected slides...")
    for i, slide in enumerate(slides):
        path = slide.get("image_path") or slide.get("path", "")
        ts   = slide.get("timestamp", 0.0)
        print(f"[ocr_processor] OCR {i+1}/{len(slides)}: {Path(path).name}")
        res = process_frame(path, ts, fast_mode=False)
        slide["ocr_text"]       = res["ocr_text"]
        slide["ocr_confidence"] = res["ocr_confidence"]

    print(f"[ocr_processor] OCR complete.")
    return slides


if __name__ == "__main__":
    import argparse, json

    parser = argparse.ArgumentParser(description="Botzilla OCR Processor")
    parser.add_argument("frames_dir",  help="Directory containing extracted frame PNGs")
    parser.add_argument("output_json", help="Output JSON path")
    args = parser.parse_args()

    frames_dir = Path(args.frames_dir)
    frames = sorted(
        [{"path": str(f), "timestamp": 0.0} for f in frames_dir.glob("*.png")],
        key=lambda x: x["path"],
    )

    results = score_frames(frames)
    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"[✓] Scored frames saved: {args.output_json}")
