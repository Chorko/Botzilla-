-- ================================================================
-- BOTZILLA — Database Schema Migration
-- Run this entire block in Supabase SQL Editor
-- or execute against any PostgreSQL-compatible database
-- ================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. Meetings ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meetings (
    id                 TEXT PRIMARY KEY,          -- 8-char meeting ID
    title              TEXT,
    meeting_type       TEXT,
    tone               TEXT,
    date               TEXT,
    time               TEXT,
    duration_seconds   NUMERIC,
    participant_count  INTEGER,
    language_primary   TEXT,
    is_multilingual    BOOLEAN  DEFAULT FALSE,
    source_type        TEXT     CHECK (source_type IN ('audio', 'video')),
    has_slides         BOOLEAN  DEFAULT FALSE,
    status             TEXT     DEFAULT 'pending'
                                CHECK (status IN (
                                    'pending', 'processing_audio', 'processing_video',
                                    'cleaning', 'summarizing', 'generating_docx',
                                    'completed', 'failed'
                                )),
    error_message      TEXT,
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER meetings_updated_at
    BEFORE UPDATE ON meetings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. Raw Transcripts (Schema 1) ───────────────────────────────
CREATE TABLE IF NOT EXISTS raw_transcripts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id       TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    transcript_json  JSONB NOT NULL,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. Cleaned Transcripts (Schema 2) ───────────────────────────
CREATE TABLE IF NOT EXISTS cleaned_transcripts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id    TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    cleaned_json  JSONB NOT NULL,
    llm_model     TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Summaries (Schema 3 — main output) ───────────────────────
CREATE TABLE IF NOT EXISTS summaries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id    TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    summary_json  JSONB NOT NULL,
    llm_model     TEXT,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Uploads ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploads (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id         TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    original_filename  TEXT NOT NULL,
    storage_path       TEXT NOT NULL,
    file_size_bytes    BIGINT,
    mime_type          TEXT,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. Performance Indexes ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_meetings_status    ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_created   ON meetings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_meeting  ON summaries(meeting_id);
CREATE INDEX IF NOT EXISTS idx_raw_meeting        ON raw_transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_cleaned_meeting    ON cleaned_transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_uploads_meeting    ON uploads(meeting_id);

-- ── 7. Verify (optional — run separately to confirm) ─────────────
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;
