"""
Botzilla — Upload Route
POST /api/upload — accepts audio or video file, saves it, triggers processing pipeline.
GET  /api/progress/{meeting_id} — SSE stream for real-time status updates.
GET  /api/meetings — list all meetings
GET  /api/meetings/{meeting_id} — get single meeting status
"""

import uuid
import json
import asyncio
from pathlib import Path

from fastapi import APIRouter, UploadFile, File, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from config.settings import OUTPUT_DIR
from storage import database_client as db
from storage.file_manager import (
    save_upload_locally,
    upload_meeting_file,
    detect_source_type,
    get_output_dir,
    get_slides_dir,
)

router = APIRouter()

# In-memory progress store: meeting_id → list of status strings
_progress: dict = {}


def _emit(meeting_id: str, msg: str):
    """Append a progress message."""
    _progress.setdefault(meeting_id, []).append(msg)


async def _run_pipeline(meeting_id: str, local_path: str, source_type: str):
    """Background task — runs the full pipeline and updates DB."""
    import json

    def emit(msg):
        _emit(meeting_id, msg)
        print(f"[pipeline:{meeting_id}] {msg}")

    try:
        out_dir = get_output_dir(meeting_id, OUTPUT_DIR)

        # ── Stage 1: Audio Engine ──
        emit("stage:audio_engine")
        try: db.update_meeting_status(meeting_id, "processing_audio")
        except Exception: pass

        if source_type == "video":
            from video.video_processor import process_video
            emit("Extracting audio + frames from video...")
            video_result = process_video(local_path, str(out_dir))
            audio_path = video_result["audio_path"]
            frames = video_result["frames"]
        else:
            audio_path = local_path
            frames = []

        from audio.audio_engine import process_audio
        emit("Transcribing and diarizing...")
        schema1 = process_audio(audio_path, meeting_id, source_type=source_type,
                                extracted_audio_path=audio_path if source_type == "video" else None)

        # Save Schema 1
        raw_path = out_dir / f"{meeting_id}_raw.json"
        raw_path.write_text(json.dumps(schema1, ensure_ascii=False, indent=2), encoding='utf-8')
        try: db.save_raw_transcript(meeting_id, schema1)
        except Exception: pass

        # ── Stage 2: Cleaner ──
        emit("stage:cleaner")
        try: db.update_meeting_status(meeting_id, "cleaning")
        except Exception: pass
        emit("Running LLM Call #1 (Cleaner)...")

        from models.cleaner import clean_transcript
        schema2 = clean_transcript(schema1)

        cleaned_path = out_dir / f"{meeting_id}_cleaned.json"
        cleaned_path.write_text(json.dumps(schema2, ensure_ascii=False, indent=2), encoding='utf-8')
        try: db.save_cleaned_transcript(meeting_id, schema2)
        except Exception: pass

        # ── Stage 3: Video slides (if applicable) ──
        slides = []
        if source_type == "video" and frames:
            emit("stage:slides")
            from video.ocr_processor import process_frames
            from video.smart_slide import select_slides

            emit("Running OCR on extracted frames...")
            ocr_frames = process_frames(frames)

            slides_dir = get_slides_dir(meeting_id, OUTPUT_DIR)
            emit("Selecting best slide per context...")
            slides = select_slides(schema2, ocr_frames, str(slides_dir), meeting_id)

        # ── Stage 4: Summary ──
        emit("stage:summary")
        try: db.update_meeting_status(meeting_id, "summarizing")
        except Exception: pass
        emit("Running LLM Call #2 (Summary)...")

        from models.summary_model import generate_summary
        schema3 = generate_summary(schema2, source_type=source_type, slides=slides)

        summary_path = out_dir / f"{meeting_id}_summary.json"
        summary_path.write_text(json.dumps(schema3, ensure_ascii=False, indent=2), encoding='utf-8')
        try: db.save_summary(meeting_id, schema3)
        except Exception: pass

        # ── Stage 5: DOCX ──
        emit("stage:docx")
        try: db.update_meeting_status(meeting_id, "generating_docx")
        except Exception: pass
        emit("Generating Word document...")

        import subprocess
        docx_script = Path(__file__).resolve().parent.parent.parent / "models" / "generate_docx.js"
        docx_path = out_dir / f"{meeting_id}_summary.docx"
        result = subprocess.run(
            ["node", str(docx_script), str(summary_path), str(docx_path)],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            emit(f"DOCX warning: {result.stderr[:200]}")

        # ── Finalize ──
        try: db.update_meeting_metadata(meeting_id, schema3)
        except Exception: pass
        emit("stage:complete")
        emit(f"done:{meeting_id}")

    except Exception as e:
        import traceback
        err = str(e)
        emit(f"error:{err}")
        db.update_meeting_status(meeting_id, "failed", error=err)
        print(f"[pipeline:{meeting_id}] FAILED: {err}")
        traceback.print_exc()


@router.post("/upload")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
):
    """
    Upload an audio or video file and start the processing pipeline.
    Returns meeting_id immediately — poll /api/progress/{meeting_id} for updates.
    """
    meeting_id = str(uuid.uuid4())[:8]
    filename = file.filename or "upload"
    source_type = detect_source_type(filename)

    # Read file
    content = await file.read()
    if not content:
        raise HTTPException(400, "Empty file")

    # Save locally
    local_path = save_upload_locally(content, filename, meeting_id, OUTPUT_DIR)

    # Create DB record
    try:
        db.create_meeting(meeting_id, filename, source_type)
    except Exception:
        pass  # Supabase optional — continue without it

    # Kick off pipeline in background
    background_tasks.add_task(_run_pipeline, meeting_id, local_path, source_type)

    return {
        "meeting_id": meeting_id,
        "filename": filename,
        "source_type": source_type,
        "status": "processing",
        "message": "Pipeline started. Subscribe to /api/progress/{meeting_id} for updates.",
    }


@router.get("/progress/{meeting_id}")
async def stream_progress(meeting_id: str):
    """SSE endpoint — streams real-time pipeline progress."""
    async def event_generator():
        sent = 0
        while True:
            messages = _progress.get(meeting_id, [])
            for msg in messages[sent:]:
                yield f"data: {msg}\n\n"
                sent += 1
                if msg.startswith("done:") or msg.startswith("error:"):
                    return
            await asyncio.sleep(0.5)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@router.get("/meetings")
def list_meetings():
    """List all meetings."""
    try:
        return db.list_meetings()
    except Exception:
        return []


@router.get("/meetings/{meeting_id}")
def get_meeting(meeting_id: str):
    try:
        meeting = db.get_meeting(meeting_id)
        if not meeting:
            raise HTTPException(404, "Meeting not found")
        return meeting
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
