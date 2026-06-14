"""
Botzilla — Chat Route
POST /api/chat/{meeting_id}  — query the meeting chatbot
GET  /api/chat/{meeting_id}/questions  — get suggested questions
"""

import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from config.settings import OUTPUT_DIR
from storage import database_client as db

router = APIRouter()

# Cache loaded chatbots by meeting_id (one per process lifetime)
_chatbot_cache: dict = {}


class ChatRequest(BaseModel):
    query: str


def _load_bot(meeting_id: str):
    """Load or retrieve cached BotzillaChatbot for a meeting."""
    if meeting_id in _chatbot_cache:
        return _chatbot_cache[meeting_id]

    # Load summary JSON
    summary = None
    try:
        summary = db.get_summary(meeting_id)
    except Exception:
        pass

    if not summary:
        local_path = OUTPUT_DIR / meeting_id / f"{meeting_id}_summary.json"
        if local_path.exists():
            summary = json.loads(local_path.read_text(encoding="utf-8"))

    if not summary:
        raise HTTPException(404, f"No summary found for meeting: {meeting_id}")

    from models.chatbot import BotzillaChatbot
    bot = BotzillaChatbot(summary)
    _chatbot_cache[meeting_id] = bot
    return bot


@router.post("/chat/{meeting_id}")
def chat(meeting_id: str, req: ChatRequest):
    """
    Answer a question about a meeting.
    Returns: answer, confidence, tier, tier_name, sources
    """
    if not req.query.strip():
        raise HTTPException(400, "Query cannot be empty")
    bot = _load_bot(meeting_id)
    return bot.ask(req.query)


@router.get("/chat/{meeting_id}/questions")
def suggested_questions(meeting_id: str):
    """Return pre-computed suggested questions for this meeting."""
    bot = _load_bot(meeting_id)
    return {"questions": bot.get_suggested_questions()}
