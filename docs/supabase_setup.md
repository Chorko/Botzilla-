# Botzilla — Supabase Setup Guide

Complete instructions for setting up the Supabase project for Botzilla.

---

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com) and sign in
2. Click **New Project**
3. Name it `botzilla`, choose a region, set a strong password
4. Wait for provisioning (~2 min)

---

## Step 2: Run the SQL Migration

Open **SQL Editor** in your Supabase dashboard and run the following migration in one shot:

```sql
-- ================================================================
-- BOTZILLA — Database Schema Migration
-- Run this entire block in Supabase SQL Editor
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

-- Auto-update updated_at
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
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id     TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    transcript_json JSONB NOT NULL,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. Cleaned Transcripts (Schema 2) ───────────────────────────
CREATE TABLE IF NOT EXISTS cleaned_transcripts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id   TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    cleaned_json JSONB NOT NULL,
    llm_model    TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. Summaries (Schema 3 — main output) ───────────────────────
CREATE TABLE IF NOT EXISTS summaries (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id   TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    summary_json JSONB NOT NULL,
    llm_model    TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. Uploads ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploads (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meeting_id        TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    original_filename TEXT NOT NULL,
    storage_path      TEXT NOT NULL,
    file_size_bytes   BIGINT,
    mime_type         TEXT,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. Performance Indexes ───────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_meetings_status     ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_created    ON meetings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_summaries_meeting   ON summaries(meeting_id);
CREATE INDEX IF NOT EXISTS idx_raw_meeting         ON raw_transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_cleaned_meeting     ON cleaned_transcripts(meeting_id);
CREATE INDEX IF NOT EXISTS idx_uploads_meeting     ON uploads(meeting_id);
```

---

## Step 3: Create the Storage Bucket

In your Supabase dashboard → **Storage** → **New Bucket**:

| Setting | Value |
|---|---|
| Name | `botzilla-files` |
| Public bucket | **OFF** (private) |

Then add these **Policies** (Storage → Policies → botzilla-files):

### Policy 1 — Allow service role full access
```sql
-- Name: service_role_all
-- Roles: service_role
-- Operation: ALL
CREATE POLICY "service_role_all" ON storage.objects
    FOR ALL
    TO service_role
    USING (bucket_id = 'botzilla-files');
```

### Policy 2 — Allow anon to read public output files
```sql
-- Name: anon_read_outputs
-- Roles: anon
-- Operation: SELECT
CREATE POLICY "anon_read_outputs" ON storage.objects
    FOR SELECT
    TO anon
    USING (
        bucket_id = 'botzilla-files'
        AND (storage_path LIKE 'slides/%' OR storage_path LIKE 'documents/%')
    );
```

---

## Step 4: Get Your API Keys

In Supabase dashboard → **Settings** → **API**:

| Key | Where to use |
|---|---|
| `Project URL` | `SUPABASE_URL` in `.env` |
| `anon / public` key | `SUPABASE_ANON_KEY` in `.env` |
| `service_role` key | `SUPABASE_KEY` in `.env` (**keep secret — server only**) |

---

## Step 5: Update `.env`

```env
SUPABASE_URL="https://your-project-ref.supabase.co"
SUPABASE_KEY="your-service-role-key"
SUPABASE_ANON_KEY="your-anon-key"
```

---

## Step 6: Verify

Run this in the SQL Editor to confirm tables exist:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Expected output:
```
cleaned_transcripts
meetings
raw_transcripts
summaries
uploads
```

---

## Notes

- The `summaries.summary_json` column stores the complete Schema 3 JSON as JSONB — this makes it queryable with Postgres JSON operators if needed later (e.g. `summary_json->'metadata'->>'title'`)
- Supabase is **optional** — if `SUPABASE_URL`/`SUPABASE_KEY` are empty, the pipeline saves everything locally to the `output/` directory and Supabase calls are silently skipped
- The `SUPABASE_KEY` (service role) must never be exposed to the frontend — only use `SUPABASE_ANON_KEY` on the client side
