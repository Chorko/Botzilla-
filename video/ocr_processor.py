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

def process_frame(frame_path: str, timestamp: float) -> dict:
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

        # 2× upscale for OCR accuracy on small text
        h, w = gray.shape
        upscaled = cv2.resize(gray, (w * 2, h * 2), interpolation=cv2.INTER_LANCZOS4)

        reader = _get_reader()

        # EasyOCR: paragraph=True and detail=1 are mutually exclusive.
        # paragraph=True returns (text,) tuples — no bbox/confidence.
        # detail=1    returns (bbox, text, conf) tuples — no merging.
        # Strategy: use detail=1 for confidence scoring, paragraph=True for clean text.
        detail_result = reader.readtext(upscaled, detail=1, paragraph=False)
        para_result   = reader.readtext(upscaled, detail=0, paragraph=True)

        # Confidence from detail pass
        confidences = [float(det[2]) for det in detail_result if len(det) >= 3]

        # Clean merged text from paragraph pass
        texts = [t.strip() for t in para_result if isinstance(t, str) and t.strip()]

        result["ocr_text"] = "\n".join(texts)
        result["ocr_confidence"] = round(
            sum(confidences) / len(confidences) if confidences else 0.0, 3
        )

    except Exception as e:
        print(f"[ocr_processor] Error on {Path(frame_path).name}: {e}")

    return result


# ──────────────────────────────────────────────
# Batch processor with dedup
# ──────────────────────────────────────────────

def process_frames(
    frames: List[dict],
    similarity_threshold: float = None,
) -> List[dict]:
    """
    Run OCR on a list of frame dicts (each has 'path' and 'timestamp').
    Marks duplicate frames using fuzzy text similarity.

    Args:
        frames: list of {"path": ..., "timestamp": ...} dicts
        similarity_threshold: override default OCR_SIMILARITY_THRESHOLD

    Returns:
        List of enriched frame dicts with OCR results
    """
    if similarity_threshold is None:
        similarity_threshold = OCR_SIMILARITY_THRESHOLD

    print(f"[ocr_processor] Processing {len(frames)} frames...")
    results = []
    last_text = ""

    for i, frame in enumerate(frames):
        path = frame.get("path", "")
        ts = frame.get("timestamp", 0.0)

        print(f"[ocr_processor] Frame {i+1}/{len(frames)}: {Path(path).name}")
        ocr_result = process_frame(path, ts)

        # Fuzzy dedup
        if last_text and ocr_result["ocr_text"]:
            if _fuzzy_similar(ocr_result["ocr_text"], last_text, similarity_threshold):
                ocr_result["is_duplicate"] = True

        if not ocr_result["is_duplicate"] and ocr_result["ocr_text"]:
            last_text = ocr_result["ocr_text"]

        results.append(ocr_result)

    non_dup = sum(1 for r in results if not r["is_duplicate"] and r["ocr_text"])
    print(f"[ocr_processor] Done — {non_dup} unique frames with text content")
    return results


if __name__ == "__main__":
    import argparse, json

    parser = argparse.ArgumentParser(description="Botzilla OCR Processor")
    parser.add_argument("frames_dir", help="Directory containing extracted frame PNGs")
    parser.add_argument("output_json", help="Output JSON path")
    args = parser.parse_args()

    frames_dir = Path(args.frames_dir)
    frames = sorted(
        [{"path": str(f), "timestamp": 0.0} for f in frames_dir.glob("*.png")],
        key=lambda x: x["path"],
    )

    results = process_frames(frames)
    with open(args.output_json, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"[✓] OCR results saved: {args.output_json}")
