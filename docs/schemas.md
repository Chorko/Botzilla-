# Botzilla — Complete JSON Schema Design
## All pipeline stages: Raw Transcript → Cleaner → Summary

---

## DECISION: Word-Level vs Segment-Level Timestamps

**Use segment-level. Not word-level.**

| Factor | Word-Level | Segment-Level |
|---|---|---|
| JSON size (1hr meeting) | ~9000 entries (~150 WPM) | ~100–200 entries |
| LLM token cost for cleaner | 5–10x higher | Baseline |
| Accuracy for ±3min slide window | Sub-second (overkill) | ±0.5s (sufficient) |
| Context switch detection | Semantic anyway (LLM decides) | Semantic anyway (LLM decides) |
| Implementation complexity | Higher | Lower |

**Why word-level is overkill for you:**  
Context switches are detected *semantically* by the LLM cleaner — it reads meaning, not milliseconds. Your slide search window is `min(5% of context duration, 3 minutes)`. Even the smallest window (5% of a 60s context = 3s) is 6x wider than segment accuracy. Sending word-level to the cleaner LLM triples your token cost for zero practical gain.

**When you'd actually need word-level:** Karaoke subtitles, precise audio clipping at exact word boundaries. Neither applies here.

WhisperX generates word alignments internally during processing — just don't serialize them into your main JSON. If you ever need word timestamps later, you can optionally dump them to a sidecar `.words.json` file without changing your pipeline schema.

---

---

---

---

## SPEAKER NAMING RULE — Read Before Implementing Anything

The LLM **never** outputs a display fallback. It outputs the truth or `null`. The app layer computes the display string.

| Field | LLM outputs | App layer computes |
|---|---|---|
| `name` in participants | resolved name OR `null` | — |
| `display_name` in participants | ❌ NEVER | `name if name else f"Speaker {N}"` |
| `speaker_name` in key_points / action_items / decisions | resolved name OR `null` | — |
| `assignee_name` in action_items | resolved name OR `null` | — |
| `decided_by_name` in decisions | resolved name OR `null` | — |
| `agreed_by_names[]` in decisions | each: resolved name OR `null` | — |

**`display_name` formula (app layer only, never LLM):**
```
N = int(speaker_id.split("_")[-1]) + 1    # SPEAKER_00→1, SPEAKER_01→2, SPEAKER_02→3
display_name = name if name else f"Speaker {N}"
```

This `display_name` is computed once after the LLM call, stored in the final enriched JSON, and used everywhere — frontend, DOCX generator, chatbot. The LLM prompt must explicitly say: *"When a name cannot be determined from the transcript, output null — never invent placeholders like 'Speaker 1'."*

---

---

# SCHEMA 1: Raw Transcript
### Same schema for Audio and Video pipelines. Only `source.type` and `source.extracted_audio_path` differ.

```json
{
  "transcript_id": "a3f2c891-...",          // UUID v4, generated at processing time
  "schema_version": "1.0",
  "source": {
    "type": "audio",                        // "audio" | "video"
    "filename": "team_standup_jan15.mp3",
    "format": "mp3",                        // mp3 | wav | mp4 | mkv | webm
    "duration_seconds": 3612.4,
    "file_size_bytes": 87654321,
    "extracted_audio_path": null            // null for audio; "/tmp/extracted/uuid.mp3" for video
  },
  "processing": {
    "engine": "whisperx",
    "whisper_model": "large-v3",
    "diarization_model": "pyannote/speaker-diarization-3.1",
    "processed_at": "2024-01-15T10:35:22Z",
    "processing_time_seconds": 847.2
  },
  "detection": {
    "language_primary": "en",              // ISO 639-1 code
    "language_confidence": 0.97,
    "is_multilingual": true,               // true for Hinglish meetings
    "languages_detected": ["en", "hi"],    // all detected languages
    "speaker_count_detected": 3,
    "diarization_confidence": 0.88         // overall pyannote confidence
  },
  "audio_quality": {
    "quality_rating": "good",             // "good" | "fair" | "poor"
    "snr_db": 22.4,                       // signal-to-noise ratio
    "has_background_noise": false,
    "has_music": false,
    "has_crosstalk": true,                // two people talking simultaneously detected
    "avg_silence_ratio": 0.18            // 18% of total duration is silence
  },
  "segments": [
    {
      "segment_id": "seg_001",
      "speaker_id": "SPEAKER_00",         // pyannote label, always SPEAKER_XX format
      "start_time": 0.0,                  // seconds, from WhisperX
      "end_time": 4.8,
      "duration": 4.8,
      "pause_before_seconds": 0.0,        // silence gap before this segment; large gaps = potential context switch signals
      "text": "Okay everyone, let's get started. We have three items today.",
      "language": "en",                   // per-segment language (handles mid-meeting code switches)
      "confidence": 0.96,                 // WhisperX transcription confidence 0.0–1.0
      "is_low_confidence": false,         // true if confidence < 0.70
      "low_confidence_flags": [],         // see flag definitions below
      "has_overlap": false,               // true if this segment overlaps with another speaker
      "is_filler_only": false             // true if entire segment is just um/uh/okay/yeah with no content
    },
    {
      "segment_id": "seg_007",
      "speaker_id": "SPEAKER_01",
      "start_time": 45.8,
      "end_time": 51.2,
      "duration": 5.4,
      "pause_before_seconds": 12.4,       // notably long pause → LLM cleaner may flag context switch
      "text": "Um, yeah so uh the the database thing we were talking about last week...",
      "language": "en",
      "confidence": 0.61,
      "is_low_confidence": true,
      "low_confidence_flags": ["filler_heavy", "uncertain_speaker"],
      "has_overlap": false,
      "is_filler_only": false
    },
    {
      "segment_id": "seg_023",
      "speaker_id": "SPEAKER_02",
      "start_time": 312.5,
      "end_time": 318.1,
      "duration": 5.6,
      "pause_before_seconds": 0.3,
      "text": "Haan, toh basically ye migration kal tak finish ho jaayegi.",
      "language": "hi",                   // Hinglish segment detected as Hindi-dominant
      "confidence": 0.81,
      "is_low_confidence": false,
      "low_confidence_flags": ["code_switch"],
      "has_overlap": false,
      "is_filler_only": false
    }
  ]
}
```

**`low_confidence_flags` possible values:**
- `"filler_heavy"` — segment dominated by um/uh/like/you know
- `"overlapping_speech"` — multiple speakers at once, text may be garbled
- `"background_noise"` — noise drowning speech in this segment
- `"inaudible"` — Whisper couldn't make out the audio
- `"uncertain_speaker"` — pyannote diarization confidence low for this speaker label
- `"code_switch"` — language switched mid-segment (e.g., Hinglish)
- `"very_short"` — segment under 0.5s, likely a stray sound

---

---

# SCHEMA 2: Cleaner Output
### LLM Call #1. Input: Raw Transcript JSON. Output: this schema.

```json
{
  "cleaned_id": "b7d91f02-...",
  "schema_version": "1.0",
  "source_transcript_id": "a3f2c891-...",
  "source_type": "audio",                  // "audio" | "video" — passed through from raw transcript
  "llm_model": "gemini-1.5-pro",
  "processed_at": "2024-01-15T10:50:11Z",

  "meeting": {
    "auto_title": "Product Team Standup – DB Migration & Q3 Roadmap",
    "title_confidence": 0.78,              // how confident LLM is about the auto-detected title
    "detected_type": "standup",
    // Possible types: "standup" | "review" | "brainstorm" | "interview" | "lecture"
    //                 "casual" | "one_on_one" | "all_hands" | "game_session" | "workshop" | "unknown"
    // IMPORTANT: "game_session" and "casual" exist for non-professional meetings
    "detected_date": "2024-01-15",         // null if not mentioned in transcript
    "detected_time": "10:30",             // null if not mentioned
    "detected_platform": "zoom",          // null if not mentioned; inferred from "you're on mute", share screen etc.
    "language_primary": "en",
    "is_multilingual": true,
    "duration_seconds": 3612.4
  },

  "speakers": [
    {
      "speaker_id": "SPEAKER_00",
      "inferred_name": "Priya",
      "name_confidence": 0.94,
      "name_source": "self_introduction",
      // name_source values:
      // "self_introduction"  — "Hi, I'm Priya"
      // "direct_address"     — "Thanks Priya, good point"
      // "contextual"         — name inferred from role/context clues
      // "unresolved"         — LLM could not determine name
      // RULE: inferred_name MUST be null when name_confidence < 0.65 OR name_source = "unresolved"
      "role_inferred": "facilitator",
      // role values: "facilitator" | "presenter" | "participant" | "note_taker"
      //              "interviewer" | "interviewee" | "host" | "unknown"
      "speaking_time_seconds": 892.3,
      "speaking_percentage": 42.1,
      "total_segments": 34,
      "merged_segments": 8,               // how many consecutive segments were merged into one
      "avg_transcription_confidence": 0.91
    },
    {
      "speaker_id": "SPEAKER_01",
      "inferred_name": "Rajan",
      "name_confidence": 0.71,            // lower confidence — name heard only once
      "name_source": "direct_address",
      "role_inferred": "participant",
      "speaking_time_seconds": 612.1,
      "speaking_percentage": 28.9,
      "total_segments": 21,
      "merged_segments": 3,
      "avg_transcription_confidence": 0.79
    },
    {
      "speaker_id": "SPEAKER_02",
      "inferred_name": null,              // could not resolve
      "name_confidence": 0.0,
      "name_source": "unresolved",
      "role_inferred": "participant",
      "speaking_time_seconds": 450.0,
      "speaking_percentage": 21.2,
      "total_segments": 15,
      "merged_segments": 2,
      "avg_transcription_confidence": 0.84
    }
  ],

  "contexts": [
    {
      "context_id": "ctx_001",
      "index": 0,                         // 0-based order of appearance
      "topic": "Meeting Kickoff & Attendance",
      "topic_keywords": ["start", "attendance", "agenda", "today"],
      "topic_type": "administrative",
      // topic_type values: "administrative" | "technical" | "strategic" | "social"
      //                    "review" | "planning" | "decision" | "other"
      "start_time": 0.0,
      "end_time": 178.5,
      "duration_seconds": 178.5,
      "slide_search_window": {
        // Formula: window_seconds = min(duration_seconds * 0.05, 180)
        // Search range: [start_time - window_seconds, start_time + window_seconds]
        "window_seconds": 8.925,          // 5% of 178.5s = 8.925s < 180s → use 8.925s
        "method": "percentage",           // "percentage" (5% used) | "capped" (3min cap applied)
        "search_from": 0.0,              // max(0, start_time - window_seconds)
        "search_to": 8.925               // start_time + window_seconds
      },
      "dominant_speaker": "SPEAKER_00",  // speaker with most time in this context; tie → lower SPEAKER_XX number wins
      "speakers_involved": ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"],
      "segments": [
        {
          "segment_id": "seg_c001_001",          // new ID for cleaned segments
          "original_segment_ids": ["seg_001", "seg_002", "seg_003"],  // source segments
          "speaker_id": "SPEAKER_00",
          "speaker_name": "Priya",               // resolved name or null
          "start_time": 0.0,
          "end_time": 22.5,
          "text": "Okay everyone, let's get started. We have three items on the agenda today: database migration status, Q3 roadmap review, and the frontend refactor update.",
          "was_merged": true,                    // true if merged from multiple raw segments
          "was_cleaned": false,                  // true if filler/noise removed from text
          "original_text": null                  // null if not cleaned; original noisy text if cleaned
        },
        {
          "segment_id": "seg_c001_002",
          "original_segment_ids": ["seg_004"],
          "speaker_id": "SPEAKER_01",
          "speaker_name": "Rajan",
          "start_time": 23.1,
          "end_time": 31.4,
          "text": "Thanks, I'm joining from the Hyderabad office today.",
          "was_merged": false,
          "was_cleaned": true,
          "original_text": "Thanks um, I'm uh joining from the Hyderabad office today."
        }
      ]
    },
    {
      "context_id": "ctx_002",
      "index": 1,
      "topic": "Database Migration Status",
      "topic_keywords": ["database", "migration", "schema", "postgres", "rollback", "timeline"],
      "topic_type": "technical",
      "start_time": 178.5,
      "end_time": 847.2,
      "duration_seconds": 668.7,
      "slide_search_window": {
        // 5% of 668.7s = 33.4s < 180s → use 33.4s
        "window_seconds": 33.435,
        "method": "percentage",
        "search_from": 145.065,           // 178.5 - 33.435
        "search_to": 211.935             // 178.5 + 33.435
      },
      "dominant_speaker": "SPEAKER_01",
      "speakers_involved": ["SPEAKER_00", "SPEAKER_01"],
      "segments": []                      // same structure as above, omitted for brevity
    }
  ],

  "cleaning_stats": {
    "original_segment_count": 87,
    "final_segment_count": 54,
    "total_merged": 28,
    "total_removed": 5,
    "names_resolved": 2,
    "names_unresolved": 1,
    "contexts_detected": 4,
    "low_confidence_segments_handled": 7
  },

  "removed_segments": [
    {
      "original_segment_id": "seg_019",
      "reason": "filler_only",
      // reason values: "filler_only" | "inaudible" | "duplicate" | "noise" | "crosstalk_artifact"
      "original_text": "Um... yeah... uh..."
    }
  ],

  "llm_notes": "SPEAKER_00 identified as Priya via self-introduction at 3.2s. SPEAKER_01 addressed as Rajan at 245.3s (confidence 0.71 — only one mention). SPEAKER_02 name not determinable from transcript. Platform inferred as Zoom from 'you were on mute' at 89.4s."
}
```

---

---

# SCHEMA 3: Summary JSON
### LLM Call #2. Input: Cleaner Output. Output: this schema.
### This single JSON drives: frontend overview + DOCX generation + chatbot context.

```json
{
  "summary_id": "c9e45a77-...",
  "schema_version": "1.0",
  "source_cleaned_id": "b7d91f02-...",
  "source_type": "audio",                  // "audio" | "video" — determines if slides section is populated
  "has_slides": false,                     // true only for video pipeline
  "llm_model": "gemini-1.5-pro",
  "generated_at": "2024-01-15T11:02:44Z",

  // ─────────────────────────────────────────
  // BLOCK 1: METADATA
  // Used by: frontend header, DOCX title page, chatbot quick context
  // ─────────────────────────────────────────
  "metadata": {
    "title": "Product Team Standup – DB Migration & Q3 Roadmap",
    "date": "2024-01-15",                  // null if not detectable
    "time": "10:30",                       // null if not detectable
    "duration_seconds": 3612.4,
    "duration_formatted": "1h 0m 12s",    // [APP] computed from duration_seconds; not LLM-generated
    "meeting_type": "standup",           // [LLM OUTPUT]
    "tone": "semi-formal",                 // "formal" | "semi-formal" | "casual"
    "language_primary": "en",
    "is_multilingual": true,
    "participant_count": 3,              // [APP] len(participants)
    "participants": [
      {
        "speaker_id": "SPEAKER_00",
        "name": "Priya",                   // [LLM OUTPUT] resolved name; null if unresolved
        "display_name": "Priya",           // [APP] computed: name if name else f"Speaker {N}" — NEVER in LLM output
        "role": "facilitator",
        "speaking_time_seconds": 892.3,
        "speaking_percentage": 42.1
      },
      {
        "speaker_id": "SPEAKER_01",
        "name": "Rajan",
        "display_name": "Rajan",
        "role": "participant",
        "speaking_time_seconds": 612.1,
        "speaking_percentage": 28.9
      },
      {
        "speaker_id": "SPEAKER_02",
        "name": null,                      // [LLM OUTPUT] name not determinable from transcript
        "display_name": "Speaker 3",       // [APP] computed: int("02")+1=3 → "Speaker 3"
        "role": "participant",
        "speaking_time_seconds": 450.0,
        "speaking_percentage": 21.2
      }
    ]
  },

  // ─────────────────────────────────────────
  // BLOCK 2: OVERVIEW
  // Used by: frontend overview card, DOCX executive summary section, chatbot quick answer
  // ─────────────────────────────────────────
  "overview": {
    "executive_summary": "The product team held a standup to review database migration progress, finalize the Q3 roadmap, and get an update on the frontend refactor. Migration is on track for a Jan 28 cutover, the roadmap was approved with two minor additions, and the frontend refactor is 70% complete. Four action items were assigned across team members.",
    "purpose": "Weekly standup to align on active engineering workstreams and unblock dependencies.",
    "outcome": "productive",
    // outcome values: "productive" | "inconclusive" | "action-heavy" | "informational" | "casual" | "mixed"
    "sentiment": "positive",
    // sentiment values: "positive" | "neutral" | "mixed" | "tense" | "negative"
    "highlights": [
      // 3-5 bullet-point highlights; used directly in frontend card and DOCX highlights box
      "Database migration on track for Jan 28 cutover with no blockers",
      "Q3 roadmap approved with two feature additions from Priya",
      "4 action items assigned; Rajan owns the schema review",
      "Frontend refactor 70% complete, estimated done by Feb 3"
    ]
  },

  // ─────────────────────────────────────────
  // BLOCK 3: TOPICS
  // Used by: frontend topic accordion, DOCX section breakdown, chatbot topic lookup
  // ─────────────────────────────────────────
  "topics": [
    {
      "topic_id": "ctx_001",               // matches context_id from cleaner output
      "title": "Meeting Kickoff & Attendance",
      "summary": "Priya opened the meeting and outlined three agenda items. All three participants confirmed attendance and Rajan noted he was joining from the Hyderabad office. No blocking issues were raised at kickoff.",
      "start_time": 0.0,
      "end_time": 178.5,
      "duration_seconds": 178.5,
      "topic_type": "administrative",
      "key_point_ids": [],                 // refs to key_points array below
      "decision_ids": [],                  // refs to decisions array below
      "action_item_ids": [],               // refs to action_items array below
      "speakers_involved": ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"],
      "slide_ids": []                      // refs to slides array; empty for audio
    },
    {
      "topic_id": "ctx_002",
      "title": "Database Migration Status",
      "summary": "Rajan presented the current migration status. Phase 1 schema changes are complete. Phase 2 data migration is underway and expected to finish by Jan 25. A rollback plan has been drafted. The team agreed on the Jan 28 cutover date with a freeze on production changes from Jan 26.",
      "start_time": 178.5,
      "end_time": 847.2,
      "duration_seconds": 668.7,
      "topic_type": "technical",
      "key_point_ids": ["kp_001", "kp_002", "kp_003"],
      "decision_ids": ["dec_001"],
      "action_item_ids": ["act_001", "act_002"],
      "speakers_involved": ["SPEAKER_00", "SPEAKER_01"],
      "slide_ids": ["slide_01", "slide_02"]  // populated only in video pipeline
    }
  ],

  // ─────────────────────────────────────────
  // BLOCK 4: KEY POINTS
  // Used by: frontend key points list, DOCX key points section
  // ─────────────────────────────────────────
  "key_points": [
    {
      "point_id": "kp_001",
      "text": "Phase 1 schema changes are complete and deployed to staging.",
      "topic_id": "ctx_002",
      "speaker_id": "SPEAKER_01",
      "speaker_name": "Rajan",
      "timestamp": 212.4,
      "importance": "high"               // "high" | "medium" | "low"
    },
    {
      "point_id": "kp_002",
      "text": "A production freeze is planned from Jan 26 to Jan 28 to support cutover.",
      "topic_id": "ctx_002",
      "speaker_id": "SPEAKER_00",
      "speaker_name": "Priya",
      "timestamp": 389.7,
      "importance": "high"
    },
    {
      "point_id": "kp_003",
      "text": "Rollback strategy has been documented but not yet reviewed by the full team.",
      "topic_id": "ctx_002",
      "speaker_id": "SPEAKER_01",
      "speaker_name": "Rajan",
      "timestamp": 445.2,
      "importance": "medium"
    }
  ],

  // ─────────────────────────────────────────
  // BLOCK 5: DECISIONS
  // Used by: frontend decisions list, DOCX decisions section
  // ─────────────────────────────────────────
  "decisions": [
    {
      "decision_id": "dec_001",
      "text": "Database migration cutover is confirmed for January 28, 2024.",
      "topic_id": "ctx_002",
      "decided_by_id": "SPEAKER_00",
      "decided_by_name": "Priya",
      "agreed_by_ids": ["SPEAKER_01", "SPEAKER_02"],
      "agreed_by_names": ["Rajan", null],  // [LLM OUTPUT] null when name unresolved — NOT "Speaker N"
      "timestamp": 521.3
    }
  ],

  // ─────────────────────────────────────────
  // BLOCK 6: ACTION ITEMS
  // Used by: frontend action items table, DOCX action items table, chatbot queries
  // All fields nullable except text and action_id — meetings may not have assignees/dates
  // ─────────────────────────────────────────
  "action_items": [
    {
      "action_id": "act_001",
      "text": "Review and approve the rollback plan document before Jan 22.",
      "topic_id": "ctx_002",
      "assignee_id": "SPEAKER_02",
      "assignee_name": null,             // [LLM OUTPUT] null when name unresolved — app renders display_name
      "due_date": "2024-01-22",          // null if not mentioned
      "priority": "high",               // "high" | "medium" | "low" | null
      "timestamp": 578.9,               // when this action item was mentioned
      "status": "open"                  // always "open" at generation time
    },
    {
      "action_id": "act_002",
      "text": "Coordinate with DevOps to schedule the production freeze window.",
      "topic_id": "ctx_002",
      "assignee_id": "SPEAKER_01",
      "assignee_name": "Rajan",
      "due_date": null,                 // no due date mentioned
      "priority": "medium",
      "timestamp": 612.1,
      "status": "open"
    },
    {
      "action_id": "act_003",
      "text": "Send the updated Q3 roadmap to all stakeholders.",
      "topic_id": "ctx_003",
      "assignee_id": "SPEAKER_00",
      "assignee_name": "Priya",
      "due_date": "2024-01-16",
      "priority": "high",
      "timestamp": 2145.8,
      "status": "open"
    }
  ],

  // ─────────────────────────────────────────
  // BLOCK 7: SPEAKER CONTRIBUTIONS
  // Used by: frontend speaker cards, DOCX speaker insights section, chatbot "what did X say"
  // ─────────────────────────────────────────
  "speaker_contributions": [
    {
      "speaker_id": "SPEAKER_00",
      "name": "Priya",                   // [LLM OUTPUT] resolved name or null
      "display_name": "Priya",           // [APP] computed — not LLM output
      "role": "facilitator",             // [LLM OUTPUT]
      "speaking_time_seconds": 892.3,    // [PASSTHROUGH] from cleaner output — not re-generated by summary LLM
      "speaking_percentage": 42.1,       // [PASSTHROUGH] from cleaner output
      "topics_led": ["ctx_001", "ctx_003"],  // [LLM OUTPUT]
      "decisions_made": ["dec_001"],
      "action_items_assigned": ["act_003"],
      "key_contributions": [
        "Facilitated the entire standup and kept discussion on track",
        "Approved the database migration timeline and production freeze",
        "Added two feature items to the Q3 roadmap"
      ]
    },
    {
      "speaker_id": "SPEAKER_01",
      "name": "Rajan",
      "display_name": "Rajan",
      "role": "participant",
      "speaking_time_seconds": 612.1,
      "speaking_percentage": 28.9,
      "topics_led": ["ctx_002"],
      "decisions_made": [],
      "action_items_assigned": ["act_002"],
      "key_contributions": [
        "Presented full database migration status update",
        "Confirmed Phase 1 schema changes are deployed to staging",
        "Proposed the production freeze window dates"
      ]
    }
  ],

  // ─────────────────────────────────────────
  // BLOCK 8: SLIDES
  // Only populated when source_type = "video" and has_slides = true
  // Empty array for audio pipeline — do not remove the key
  // ─────────────────────────────────────────
  "slides": [
    {
      "slide_id": "slide_01",
      "topic_id": "ctx_002",
      "timestamp": 198.3,               // frame timestamp in original video
      "image_path": "/storage/meetings/uuid/slides/slide_01.png",
      "ocr_text": "Database Migration Timeline\nPhase 1: Schema changes (Jan 20) ✓\nPhase 2: Data migration (Jan 25)\nPhase 3: Cutover (Jan 28)",
      "ocr_confidence": 0.94,
      "sharpness_score": 0.88,          // 0.0-1.0, computed by smart_slide
      "text_density": 0.43,             // ratio of text-covered area in frame
      "relevance_score": 0.91,          // composite score used for deduplication/ranking
      "extraction_method": "context_boundary"   // "context_boundary" | "manual_override"
    }
  ],

  // ─────────────────────────────────────────
  // BLOCK 9: DOCX CONFIG
  // Used only by generate_docx endpoint — tells python-docx what to render and how
  // No LLM should ever read this block
  // ─────────────────────────────────────────
  "docx_config": {
    "document_title": "Meeting Summary – Product Team Standup",
    "document_subtitle": "January 15, 2024  |  1h 0m 12s  |  3 Participants",
    "sections_to_include": {
      "cover_page": true,
      "executive_summary": true,
      "highlights": true,
      "topics_breakdown": true,
      "key_points": true,
      "decisions": true,
      "action_items": true,
      "speaker_contributions": true,
      "slides": false                   // matches has_slides; if true, slides embedded inline with topics
    },
    "formatting": {
      "action_items_as_table": true,    // false = bullet list
      "decisions_as_table": false,
      "include_timestamps": true,       // show (12:32) style timestamps next to points
      "tone": "semi-formal",            // affects header/footer style
      "slides_placement": "inline",     // "inline" = right after topic summary | "appendix" = grouped at end of doc
      "speaker_name_fallback": "Speaker {n}"  // {n} = int(SPEAKER_XX.split("_")[-1]) + 1
    }
  },

  // ─────────────────────────────────────────
  // BLOCK 10: CHATBOT CONTEXT
  // [APP] Entire block is computed programmatically. NOT generated by summary LLM.
  // Computed AFTER app layer enriches LLM output with display_names.
  // Uses display_name everywhere so nulls never surface to chatbot.
  // ─────────────────────────────────────────
  "chatbot_context": {
    "quick_facts": [
      "Meeting: Product Team Standup on Jan 15, 2024",
      "Duration: 1 hour 0 minutes",
      "3 participants: Priya (facilitator), Rajan, Speaker 3",
      "4 topics discussed",
      "3 action items assigned",
      "1 decision made"
    ],
    "topic_index": {
      "ctx_001": "Meeting Kickoff & Attendance (0:00 – 2:58)",
      "ctx_002": "Database Migration Status (2:58 – 14:07)",
      "ctx_003": "Q3 Roadmap Review (14:07 – 45:22)",
      "ctx_004": "Frontend Refactor Update (45:22 – 1:00:12)"
    },
    "suggested_questions": [
      "What was decided about the database migration?",
      "What are Rajan's action items?",
      "Summarize the Q3 roadmap discussion.",
      "Who is responsible for the rollback plan review?"
    ]
  }
}
```

---

---

# KEY VALIDATION RULES

These are the constraints to enforce at each pipeline stage.

### Raw Transcript
- `segment_id` must be unique within a transcript
- `end_time > start_time` always
- `pause_before_seconds >= 0`
- `confidence` in range `[0.0, 1.0]`
- `is_low_confidence = true` when `confidence < 0.70`
- `speaker_id` must match `SPEAKER_XX` format where XX is zero-padded int
- `languages_detected` must include `language_primary`

### Cleaner Output
- Every `context_id` must be unique
- `contexts` array ordered by `start_time` ascending
- `slide_search_window.search_from >= 0` (can't go negative)
- `slide_search_window.window_seconds = min(duration_seconds * 0.05, 180)`
- `segment.original_segment_ids` must reference valid segment IDs from raw transcript
- `speaking_percentage` across all speakers should sum to approximately 100 (allow ±2% for rounding)
- `inferred_name` MUST be `null` when `name_confidence < 0.65` OR `name_source = "unresolved"`
- `name_confidence = 0.0` when `name_source = "unresolved"`
- `dominant_speaker`: speaker with most speaking time in context; tie → lower SPEAKER_XX number wins

### Summary JSON
- `topic_id` values in topics array must match `context_id` values from cleaner
- `key_point_ids`, `decision_ids`, `action_item_ids` in topics must reference valid IDs in their respective arrays
- `slides` array must be empty when `has_slides = false`
- `docx_config.sections_to_include.slides` must match `has_slides`
- `docx_config.formatting.slides_placement` must be `"inline"` or `"appendix"`
- `assignee_id` in action_items must reference a valid `speaker_id` in participants (or be null)
- `speaking_percentage` in speaker_contributions must sum to ~100 (±2%)
- `status` in action_items must always be `"open"` at generation time
- `speaker_name`, `assignee_name`, `decided_by_name` MUST be `null` when speaker name is unresolved — never "Speaker N"
- `agreed_by_names` array elements MUST be `null` for unresolved speakers — never "Speaker N"
- `display_name` MUST be computed: `name if name else f"Speaker {int(speaker_id.split("_")[-1]) + 1}"`
- `duration_formatted` and `participant_count` are app-computed, not LLM output
- `speaking_time_seconds` and `speaking_percentage` in speaker_contributions are passed through from cleaner, not re-generated

---

---

---

---

# LLM OUTPUT vs APP LAYER — Who Produces What

This table defines exactly what the summary LLM call should output vs what the application layer computes after receiving the LLM response.

### What the Summary LLM Outputs (raw from API)
| Field | LLM responsibility |
|---|---|
| `overview` (all fields) | ✅ LLM |
| `topics[].title`, `.summary`, `.topic_type` | ✅ LLM |
| `topics[].key_point_ids`, `.decision_ids`, `.action_item_ids`, `.speakers_involved` | ✅ LLM |
| `key_points[].text`, `.importance`, `.speaker_id`, `.timestamp` | ✅ LLM |
| `key_points[].speaker_name` | ✅ LLM (resolved name or **null**) |
| `decisions[].text`, `.decided_by_id`, `.agreed_by_ids`, `.timestamp` | ✅ LLM |
| `decisions[].decided_by_name`, `.agreed_by_names[]` | ✅ LLM (resolved name or **null** per element) |
| `action_items[].text`, `.assignee_id`, `.due_date`, `.priority`, `.timestamp` | ✅ LLM |
| `action_items[].assignee_name` | ✅ LLM (resolved name or **null**) |
| `speaker_contributions[].key_contributions`, `.topics_led`, `.decisions_made`, `.action_items_assigned` | ✅ LLM |
| `speaker_contributions[].name` | ✅ LLM (resolved name or **null**) |

### What the App Layer Computes (after LLM call, before storing to DB)
| Field | How computed |
|---|---|
| `metadata.duration_formatted` | `seconds_to_hms(duration_seconds)` |
| `metadata.participant_count` | `len(participants)` |
| `metadata.participants[].display_name` | `name if name else f"Speaker {N}"` |
| `speaker_contributions[].display_name` | Same formula |
| `speaker_contributions[].speaking_time_seconds` | Copied from cleaner `speakers[].speaking_time_seconds` |
| `speaker_contributions[].speaking_percentage` | Copied from cleaner `speakers[].speaking_percentage` |
| `speaker_contributions[].role` | Copied from cleaner `speakers[].role_inferred` |
| `topics[].slide_ids` | Assigned by smart_slide module (video pipeline only) |
| `slides[]` | Entire block from smart_slide module |
| `has_slides` | `source_type == "video"` |
| `docx_config` | Entire block assembled by app (not LLM) |
| `chatbot_context` | Entire block computed from above (not LLM) |

### What the Cleaner LLM Outputs (for reference)
| Field | LLM responsibility |
|---|---|
| `meeting.*` (title, type, date, time, platform) | ✅ LLM |
| `speakers[].inferred_name` (or null) | ✅ LLM |
| `speakers[].name_confidence`, `.name_source`, `.role_inferred` | ✅ LLM |
| `contexts[].topic`, `.topic_keywords`, `.topic_type` | ✅ LLM |
| `contexts[].segments[].text` (cleaned) | ✅ LLM |
| `contexts[].segments[].was_merged`, `.was_cleaned`, `.original_text` | ✅ LLM |
| `removed_segments[]`, `.llm_notes` | ✅ LLM |

### What Preprocessing Does BEFORE the Cleaner LLM Call
Before sending the raw transcript to the LLM, the application should programmatically:
1. **Merge consecutive same-speaker segments** — reduces segment count by ~30%, cuts LLM token cost
2. **Remove `is_filler_only = true` segments** — they have zero content value for the LLM
3. **Strip `processing` and `audio_quality` blocks** — LLM doesn't need them
4. **Send only `detection`, `speakers_detected`, and `segments`** to the LLM

This makes the cleaner LLM call leaner without losing any output quality.

---

---

# LLM CALL OPTIMIZATION NOTES

## Why keeping 2 calls is the right call (not 1)

Combining Cleaner + Summary into one call seems attractive but breaks for two reasons:
1. **No intermediate state.** If the combined call fails or produces bad output, you have nothing. With 2 calls, a bad summary still leaves you with a valid cleaned transcript.
2. **Prompt complexity.** Asking one LLM to simultaneously clean noise, resolve names, detect context boundaries, AND write a structured summary produces worse output than two focused calls.

## Making each call leaner

**Cleaner call:**
- Strip `processing` and `audio_quality` blocks — LLM doesn't need them
- Only send `detection`, `segments` array to the LLM
- Use structured output mode (JSON schema enforcement) so LLM doesn't waste tokens on prose

**Summary call:**
- Do NOT send full segments to the LLM — send only the cleaned `contexts` array with their `segments`
- Strip `cleaning_stats`, `removed_segments`, `llm_notes` from cleaner output before passing to summary LLM
- The summary LLM should receive: meeting metadata + speakers + contexts (with their segments)

**Chatbot:**
- Zero extra LLM calls at query time
- Chatbot gets `chatbot_context` + `topics` + `key_points` + `decisions` + `action_items` as RAG context
- That's ~20% of the full summary JSON, sufficient for Q&A

## Future: merge to 1 call
If you ever want to go to 1 call, the right approach is:
- Use Gemini 1.5 Pro (1M context window)
- Send raw transcript directly
- Prompt does cleaning + summarization in one pass
- Risk: harder to debug, no intermediate cleaned transcript saved
- Recommended only after the 2-call version is stable and you have eval data to compare quality
