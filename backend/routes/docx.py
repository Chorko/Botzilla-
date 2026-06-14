"""
Botzilla — DOCX Route
POST /api/docx/{meeting_id}  — (re)generate and download the Word document
GET  /api/docx/{meeting_id}  — download existing DOCX
"""

import json
import subprocess
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from config.settings import OUTPUT_DIR
from storage import database_client as db

router = APIRouter()

DOCX_SCRIPT = Path(__file__).resolve().parent.parent.parent / "models" / "generate_docx.js"


def _generate(meeting_id: str) -> Path:
    """Trigger generate_docx.js and return the output path."""
    out_dir = OUTPUT_DIR / meeting_id
    summary_path = out_dir / f"{meeting_id}_summary.json"
    docx_path    = out_dir / f"{meeting_id}_summary.docx"

    if not summary_path.exists():
        # Try pulling from DB
        try:
            data = db.get_summary(meeting_id)
            if data:
                out_dir.mkdir(parents=True, exist_ok=True)
                summary_path.write_text(json.dumps(data, ensure_ascii=False, indent=2))
        except Exception:
            pass

    if not summary_path.exists():
        raise HTTPException(404, "Summary JSON not found — run upload first")

    result = subprocess.run(
        ["node", str(DOCX_SCRIPT), str(summary_path), str(docx_path)],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise HTTPException(500, f"DOCX generation failed: {result.stderr[:400]}")

    return docx_path


@router.get("/docx/{meeting_id}")
def download_docx(meeting_id: str):
    """Download existing or freshly generated DOCX."""
    docx_path = OUTPUT_DIR / meeting_id / f"{meeting_id}_summary.docx"
    if not docx_path.exists():
        docx_path = _generate(meeting_id)
    return FileResponse(
        str(docx_path),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"botzilla_{meeting_id}_summary.docx",
    )


@router.post("/docx/{meeting_id}")
def regenerate_docx(meeting_id: str):
    """Force-regenerate the DOCX."""
    docx_path = _generate(meeting_id)
    return {"status": "ok", "path": str(docx_path)}
