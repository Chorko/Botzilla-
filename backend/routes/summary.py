"""
Botzilla — Summary Route
GET  /api/summary/{meeting_id}  — returns full Schema 3 JSON
"""

import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from config.settings import OUTPUT_DIR
from storage import database_client as db

router = APIRouter()


@router.get("/summary/{meeting_id}")
def get_summary(meeting_id: str):
    """Return the Schema 3 summary JSON for a meeting."""
    # Try Supabase first
    try:
        data = db.get_summary(meeting_id)
        if data:
            return data
    except Exception:
        pass

    # Fallback: read from local output dir
    local_path = OUTPUT_DIR / meeting_id / f"{meeting_id}_summary.json"
    if local_path.exists():
        return json.loads(local_path.read_text(encoding="utf-8"))

    raise HTTPException(404, f"Summary not found for meeting: {meeting_id}")
