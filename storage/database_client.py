"""
Botzilla — Supabase Database Client
CRUD operations for meetings, transcripts, summaries, and uploads.
"""

import sys
import json
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import SUPABASE_URL, SUPABASE_KEY


def _get_client():
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in .env")
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)


# ──────────────────────────────────────────────
# Meetings
# ──────────────────────────────────────────────

def create_meeting(meeting_id: str, filename: str, source_type: str) -> dict:
    """Insert a new meeting record with status 'pending'."""
    db = _get_client()
    data = {
        "id": meeting_id,
        "source_type": source_type,
        "status": "pending",
    }
    res = db.table("meetings").insert(data).execute()
    return res.data[0] if res.data else {}


def update_meeting_status(meeting_id: str, status: str, error: str = None):
    """Update meeting processing status."""
    db = _get_client()
    data = {"status": status}
    if error:
        data["error_message"] = error
    db.table("meetings").update(data).eq("id", meeting_id).execute()


def update_meeting_metadata(meeting_id: str, summary: dict):
    """Populate meeting metadata from Schema 3 after processing."""
    db = _get_client()
    meta = summary.get("metadata", {})
    data = {
        "title": meta.get("title"),
        "meeting_type": meta.get("meeting_type"),
        "tone": meta.get("tone"),
        "date": meta.get("date"),
        "time": meta.get("time"),
        "duration_seconds": meta.get("duration_seconds"),
        "participant_count": meta.get("participant_count"),
        "language_primary": meta.get("language_primary"),
        "is_multilingual": meta.get("is_multilingual", False),
        "has_slides": summary.get("has_slides", False),
        "status": "completed",
    }
    db.table("meetings").update(data).eq("id", meeting_id).execute()


def get_meeting(meeting_id: str) -> Optional[dict]:
    db = _get_client()
    res = db.table("meetings").select("*").eq("id", meeting_id).execute()
    return res.data[0] if res.data else None


def list_meetings(limit: int = 50) -> list:
    db = _get_client()
    res = (
        db.table("meetings")
        .select("id,title,meeting_type,status,created_at,duration_seconds,participant_count")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


# ──────────────────────────────────────────────
# Transcripts + Summaries
# ──────────────────────────────────────────────

def save_raw_transcript(meeting_id: str, schema1: dict) -> str:
    """Save Schema 1 JSON to raw_transcripts table."""
    db = _get_client()
    res = db.table("raw_transcripts").insert({
        "meeting_id": meeting_id,
        "transcript_json": schema1,
    }).execute()
    return res.data[0]["id"] if res.data else None


def save_cleaned_transcript(meeting_id: str, schema2: dict) -> str:
    """Save Schema 2 JSON to cleaned_transcripts table."""
    db = _get_client()
    res = db.table("cleaned_transcripts").insert({
        "meeting_id": meeting_id,
        "cleaned_json": schema2,
        "llm_model": schema2.get("llm_model"),
    }).execute()
    return res.data[0]["id"] if res.data else None


def save_summary(meeting_id: str, schema3: dict) -> str:
    """Save Schema 3 JSON to summaries table."""
    db = _get_client()
    res = db.table("summaries").insert({
        "meeting_id": meeting_id,
        "summary_json": schema3,
        "llm_model": schema3.get("llm_model"),
    }).execute()
    return res.data[0]["id"] if res.data else None


def get_summary(meeting_id: str) -> Optional[dict]:
    """Retrieve Schema 3 JSON for a meeting."""
    db = _get_client()
    res = (
        db.table("summaries")
        .select("summary_json")
        .eq("meeting_id", meeting_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if res.data:
        return res.data[0]["summary_json"]
    return None


# ──────────────────────────────────────────────
# Uploads
# ──────────────────────────────────────────────

def save_upload_record(meeting_id: str, filename: str, storage_path: str,
                        file_size: int, mime_type: str) -> str:
    db = _get_client()
    res = db.table("uploads").insert({
        "meeting_id": meeting_id,
        "original_filename": filename,
        "storage_path": storage_path,
        "file_size_bytes": file_size,
        "mime_type": mime_type,
    }).execute()
    return res.data[0]["id"] if res.data else None
