"""
Botzilla — FastAPI Backend
Entry point. Mounts all routes.
"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.routes import upload, summary, docx, chat
from config.settings import OUTPUT_DIR

app = FastAPI(
    title="Botzilla API",
    description="AI Meeting Summarizer — Backend API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes
app.include_router(upload.router,  prefix="/api", tags=["upload"])
app.include_router(summary.router, prefix="/api", tags=["summary"])
app.include_router(docx.router,    prefix="/api", tags=["docx"])
app.include_router(chat.router,    prefix="/api", tags=["chat"])

# Serve generated output files (slides, docx)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")


@app.get("/health")
def health():
    return {"status": "ok", "service": "botzilla"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app:app", host="0.0.0.0", port=8000, reload=True)
