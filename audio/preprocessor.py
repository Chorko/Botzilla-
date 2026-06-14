"""
Botzilla — Audio Preprocessor
Converts any audio format to PCM WAV at 16kHz mono using FFmpeg.
WhisperX was trained on 16kHz — this pre-processing step improves accuracy.
"""

import os
import subprocess
import tempfile
from pathlib import Path


def convert_to_wav(input_path: str, output_path: str = None) -> str:
    """
    Convert audio file to PCM WAV 16kHz mono using FFmpeg.

    Args:
        input_path: Path to source audio file (mp3, m4a, flac, etc.)
        output_path: Optional output path. If None, creates a temp file.

    Returns:
        Path to the converted WAV file.
    """
    input_path = str(input_path)

    if output_path is None:
        # Create a temp file alongside the input
        base = Path(input_path).stem
        parent = Path(input_path).parent
        output_path = str(parent / f"{base}_16k.wav")

    cmd = [
        "ffmpeg",
        "-y",                      # overwrite
        "-i", input_path,          # input
        "-ac", "1",                # mono
        "-ar", "16000",            # 16kHz sample rate
        "-acodec", "pcm_s16le",   # PCM 16-bit little-endian
        "-vn",                     # no video
        output_path,
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        raise RuntimeError(
            f"FFmpeg audio conversion failed:\n{result.stderr}"
        )

    print(f"[preprocessor] Converted: {Path(input_path).name} → {Path(output_path).name} (16kHz mono WAV)")
    return output_path


def get_audio_duration(file_path: str) -> float:
    """Get audio duration in seconds using ffprobe."""
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(file_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {result.stderr}")
    return float(result.stdout.strip())


def get_file_size(file_path: str) -> int:
    """Return file size in bytes."""
    return os.path.getsize(str(file_path))
