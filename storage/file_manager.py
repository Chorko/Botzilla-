"""
Botzilla — File Manager
Handles upload storage and file paths for audio/video uploads,
slide images, and generated DOCX files.

Storage layout in Supabase Storage (bucket: botzilla-files):
  uploads/{meeting_id}/original.{ext}
  slides/{meeting_id}/{slide_filename}
  documents/{meeting_id}/summary.docx
"""

import os
import shutil
import mimetypes
from pathlib import Path
from typing import Optional

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import SUPABASE_URL, SUPABASE_KEY

BUCKET_NAME = "botzilla-files"

AUDIO_MIME_TYPES = {"audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4",
                    "audio/flac", "audio/ogg", "audio/aac"}
VIDEO_MIME_TYPES = {"video/mp4", "video/x-matroska", "video/webm",
                    "video/avi", "video/quicktime", "video/x-ms-wmv"}


def _get_storage():
    from supabase import create_client
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    return client.storage


def detect_mime_type(filename: str) -> str:
    mime, _ = mimetypes.guess_type(filename)
    return mime or "application/octet-stream"


def detect_source_type(filename: str) -> str:
    """Return 'audio' or 'video' from filename."""
    mime = detect_mime_type(filename)
    if mime in VIDEO_MIME_TYPES:
        return "video"
    return "audio"


# ──────────────────────────────────────────────
# Local temp storage
# ──────────────────────────────────────────────

def save_upload_locally(file_bytes: bytes, filename: str, meeting_id: str,
                         local_base: Path) -> str:
    """Save uploaded file to local temp storage. Returns local path."""
    upload_dir = local_base / "uploads" / meeting_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    ext = Path(filename).suffix
    dest = upload_dir / f"original{ext}"
    dest.write_bytes(file_bytes)
    return str(dest)


# ──────────────────────────────────────────────
# Supabase Storage upload
# ──────────────────────────────────────────────

def upload_to_supabase(local_path: str, storage_path: str,
                        content_type: str = None) -> Optional[str]:
    """
    Upload a local file to Supabase Storage.
    Returns the public URL or None if disabled.
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        storage = _get_storage()
        with open(local_path, "rb") as f:
            storage.from_(BUCKET_NAME).upload(
                storage_path,
                f,
                file_options={
                    "upsert": "true",
                    "content-type": content_type or detect_mime_type(local_path),
                },
            )
        return storage.from_(BUCKET_NAME).get_public_url(storage_path)
    except Exception as e:
        print(f"[file_manager] Supabase upload warning: {e}")
        return None


def upload_meeting_file(local_path: str, meeting_id: str, filename: str) -> Optional[str]:
    """Upload the original uploaded audio/video file."""
    ext = Path(filename).suffix
    storage_path = f"uploads/{meeting_id}/original{ext}"
    return upload_to_supabase(local_path, storage_path, detect_mime_type(filename))


def upload_slide(local_path: str, meeting_id: str, slide_filename: str) -> Optional[str]:
    """Upload a slide PNG to storage."""
    storage_path = f"slides/{meeting_id}/{slide_filename}"
    return upload_to_supabase(local_path, storage_path, "image/png")


def upload_docx(local_path: str, meeting_id: str) -> Optional[str]:
    """Upload the generated DOCX to storage."""
    storage_path = f"documents/{meeting_id}/summary.docx"
    return upload_to_supabase(
        local_path, storage_path,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )


# ──────────────────────────────────────────────
# Path helpers
# ──────────────────────────────────────────────

def get_output_dir(meeting_id: str, base: Path) -> Path:
    d = base / meeting_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def get_slides_dir(meeting_id: str, base: Path) -> Path:
    d = base / meeting_id / "slides"
    d.mkdir(parents=True, exist_ok=True)
    return d
