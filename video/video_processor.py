"""
Botzilla — Video Processor
Handles video input for Pipeline B:
  1. Extract audio track → WAV for audio_engine.py
  2. Extract scene-change frames with global timestamps

This is a clean rewrite of ApplicationCodeFile/vedio_processor.py.
Key improvements:
  - Returns structured data instead of side-effects
  - No direct OCR call (that's ocr_processor.py's job)
  - Works with absolute paths throughout
  - Uses config constants for frame dimensions
"""

import subprocess
import os
import re
import math
import shutil
import uuid
from pathlib import Path
from typing import List, Tuple

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import (
    FRAME_WIDTH,
    FRAME_HEIGHT,
    FRAME_HEARTBEAT_INTERVAL,
    SCENE_CHANGE_THRESHOLD,
    TARGET_SAMPLE_RATE,
    FFMPEG_PATH,
    FFPROBE_PATH,
)


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

def _run(cmd: list, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    """Run a subprocess command."""
    return subprocess.run(
        cmd,
        capture_output=capture,
        text=True,
        check=check,
    )


def get_video_duration(video_path: str) -> float:
    """Get video duration in seconds via ffprobe."""
    result = _run([
        FFPROBE_PATH, "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ])
    return float(result.stdout.strip())


def get_video_info(video_path: str) -> dict:
    """Get basic video metadata."""
    duration = get_video_duration(video_path)
    p = Path(video_path)
    return {
        "filename": p.name,
        "format": p.suffix.lstrip("."),
        "duration_seconds": round(duration, 3),
        "file_size_bytes": p.stat().st_size,
    }


# ──────────────────────────────────────────────
# Audio extraction
# ──────────────────────────────────────────────

def extract_audio(video_path: str, output_path: str = None) -> str:
    """
    Extract audio track from video as 16kHz mono WAV.
    Returns the path to the extracted WAV file.
    """
    video_path = str(Path(video_path).resolve())
    if output_path is None:
        stem = Path(video_path).stem
        output_path = str(Path(video_path).parent / f"{stem}_audio.wav")

    cmd = [
        FFMPEG_PATH, "-y",
        "-i", video_path,
        "-ac", "1",                    # mono
        "-ar", str(TARGET_SAMPLE_RATE),  # 16kHz
        "-acodec", "pcm_s16le",        # PCM WAV
        "-vn",                          # no video
        output_path,
    ]
    result = _run(cmd)
    if not Path(output_path).exists():
        raise RuntimeError(f"Audio extraction failed:\n{result.stderr}")

    print(f"[video_processor] Audio extracted: {Path(output_path).name}")
    return output_path


# ──────────────────────────────────────────────
# Frame extraction
# ──────────────────────────────────────────────

def extract_frames(
    video_path: str,
    output_dir: str,
    chunk_size: int = 30,
) -> List[Tuple[str, float]]:
    """
    Extract scene-change frames from video using FFmpeg smart scene detection.
    Processes video in 30-second chunks to avoid memory issues.

    Returns:
        List of (frame_path, global_timestamp_seconds) tuples, sorted by timestamp.
    """
    video_path = str(Path(video_path).resolve())
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    total_duration = get_video_duration(video_path)
    stem = Path(video_path).stem

    # Temp directory for per-chunk frames
    temp_dir = output_dir / f"_temp_{uuid.uuid4().hex[:8]}"
    temp_dir.mkdir(exist_ok=True)

    # Smart filter: heartbeat every N seconds + scene change detection
    smart_filter = (
        f"select='isnan(prev_selected_t)+gte(t-prev_selected_t,{FRAME_HEARTBEAT_INTERVAL})"
        f"+gt(scene,{SCENE_CHANGE_THRESHOLD})',"
        f"scale={FRAME_WIDTH}:{FRAME_HEIGHT}:flags=lanczos,"
        f"showinfo"
    )

    all_frames: List[Tuple[str, float]] = []
    frame_counter = 0

    try:
        for chunk_start in range(0, int(total_duration), chunk_size):
            chunk_name = str(temp_dir / f"chunk_{chunk_start}.mp4")

            # Slice chunk (check=False — short last-chunk is normal; log & skip bad chunks)
            slice_result = _run([
                FFMPEG_PATH, "-y",
                "-ss", str(chunk_start),
                "-i", video_path,
                "-t", str(chunk_size),
                "-c", "copy",
                chunk_name,
            ], check=False)
            if slice_result.returncode != 0 or not Path(chunk_name).exists():
                print(f"[video_processor] Warning: chunk at {chunk_start}s failed, skipping.")
                continue

            # Snapshot files already in temp_dir before extraction, so we only
            # pick up files created by THIS chunk (not leftover from previous chunks)
            files_before = set(temp_dir.glob("frame_*.png"))

            # Extract frames from chunk
            frame_pattern = str(temp_dir / "frame_%04d.png")
            extract_result = _run([
                FFMPEG_PATH, "-y",
                "-i", chunk_name,
                "-vf", smart_filter,
                "-fps_mode", "vfr",
                frame_pattern,
            ], check=False)

            # Parse timestamps from ffmpeg stderr (showinfo filter)
            chunk_times = []
            for line in extract_result.stderr.split("\n"):
                if "pts_time:" in line:
                    m = re.search(r"pts_time:([\d.]+)", line)
                    if m:
                        chunk_times.append(float(m.group(1)))

            # Only consider frames that were NEW in this chunk
            new_frame_files = sorted(
                f for f in temp_dir.glob("frame_*.png")
                if f not in files_before
            )
            for idx, frame_file in enumerate(new_frame_files):
                if idx >= len(chunk_times):
                    break
                global_ts = chunk_start + chunk_times[idx]

                # Rename to final global name and move to output_dir
                final_name = f"{stem}_frame_{frame_counter:04d}.png"
                final_path = output_dir / final_name
                frame_file.replace(final_path)
                all_frames.append((str(final_path), round(global_ts, 3)))
                frame_counter += 1

            # Cleanup chunk file
            try:
                Path(chunk_name).unlink(missing_ok=True)
            except Exception:
                pass

        print(f"[video_processor] Extracted {len(all_frames)} frames from {Path(video_path).name}")
        return sorted(all_frames, key=lambda x: x[1])

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ──────────────────────────────────────────────
# Full pipeline entry point
# ──────────────────────────────────────────────

def process_video(video_path: str, output_dir: str) -> dict:
    """
    Run the full video preprocessing pipeline.

    Args:
        video_path: Path to source video file
        output_dir: Directory to save audio + frames

    Returns:
        dict with:
          - audio_path: extracted WAV file
          - frames: list of {path, timestamp} dicts
          - video_info: metadata dict
    """
    video_path = str(Path(video_path).resolve())
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    frames_dir = output_dir / "frames"

    print(f"[video_processor] Processing: {Path(video_path).name}")
    info = get_video_info(video_path)
    print(f"[video_processor] Duration: {info['duration_seconds']:.1f}s")

    # Step 1: Extract audio
    audio_path = extract_audio(
        video_path,
        str(output_dir / f"{Path(video_path).stem}_audio.wav"),
    )

    # Step 2: Extract frames
    frames_raw = extract_frames(video_path, str(frames_dir))
    frames = [{"path": p, "timestamp": ts} for p, ts in frames_raw]

    return {
        "audio_path": audio_path,
        "frames": frames,
        "video_info": info,
        "frames_dir": str(frames_dir),
    }


if __name__ == "__main__":
    import argparse, json
    parser = argparse.ArgumentParser(description="Botzilla Video Processor")
    parser.add_argument("video_file", help="Path to video file")
    parser.add_argument("output_dir", help="Output directory")
    args = parser.parse_args()

    result = process_video(args.video_file, args.output_dir)
    print(json.dumps({
        "audio_path": result["audio_path"],
        "frame_count": len(result["frames"]),
        "video_info": result["video_info"],
    }, indent=2))
