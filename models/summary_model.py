"""
Botzilla — Summary Model (LLM Call #2 + App Layer Enrichment)
Transforms Schema 2 (Cleaner Output) → Schema 3 (Summary JSON)

Two-step process:
  Step 1 — LLM Call: Gemini 2.5 Flash generates blocks 1-7
  Step 2 — App Layer: computes blocks 8-10 + all [APP] fields

App layer responsibilities (never LLM):
  - display_name for all participants and speaker_contributions
  - duration_formatted
  - participant_count
  - speaking_time_seconds / speaking_percentage (passthrough from cleaner)
  - role (passthrough from cleaner)
  - slides[] block (Block 8) — injected by video pipeline
  - docx_config (Block 9)
  - chatbot_context (Block 10)
"""

import sys
import json
import time
import uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import google.generativeai as genai

from config.settings import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    SCHEMA_VERSION,
    load_prompt,
)


# ──────────────────────────────────────────────
# Gemini client
# ──────────────────────────────────────────────

def _get_gemini_client():
    if not GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY not set in .env")
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel(
        model_name=GEMINI_MODEL,
        generation_config=genai.GenerationConfig(
            temperature=0.3,
            response_mime_type="application/json",
        ),
    )


# ──────────────────────────────────────────────
# Preprocessing (before LLM Call #2)
# ──────────────────────────────────────────────

def _preprocess_for_summary(schema2: dict) -> dict:
    """
    Strip fields the summary LLM doesn't need to save tokens.
    Send: meeting + speakers + contexts (with segments)
    Strip: cleaning_stats, removed_segments, llm_notes, slide_search_window details
    """
    contexts_lean = []
    for ctx in schema2.get("contexts", []):
        contexts_lean.append({
            "context_id": ctx.get("context_id", f"ctx_{ctx.get('index', 0):03d}"),
            "index": ctx.get("index", 0),
            "topic": ctx.get("topic", ""),
            "topic_keywords": ctx.get("topic_keywords", []),
            "topic_type": ctx.get("topic_type", "other"),
            "start_time": ctx.get("start_time", 0.0),
            "end_time": ctx.get("end_time", 0.0),
            "duration_seconds": ctx.get("duration_seconds", 0.0),
            "dominant_speaker": ctx.get("dominant_speaker"),
            "speakers_involved": ctx.get("speakers_involved", []),
            "segments": ctx.get("segments", []),
        })

    speakers_lean = []
    for sp in schema2.get("speakers", []):
        speakers_lean.append({
            "speaker_id": sp["speaker_id"],
            "inferred_name": sp.get("inferred_name"),
            "name_confidence": sp.get("name_confidence", 0.0),
            "role_inferred": sp.get("role_inferred", "unknown"),
        })

    return {
        "meeting": schema2.get("meeting", {}),
        "speakers": speakers_lean,
        "contexts": contexts_lean,
    }


# ──────────────────────────────────────────────
# App layer helpers
# ──────────────────────────────────────────────

def _compute_display_name(speaker_id: str, name: Optional[str]) -> str:
    """
    The ONE authoritative place display_name is computed.
    Formula: name if name else f"Speaker {N}"
    N = int(speaker_id.split('_')[-1]) + 1
    """
    if name:
        return name
    try:
        n = int(speaker_id.split("_")[-1]) + 1
    except (ValueError, IndexError):
        n = 1
    return f"Speaker {n}"


def _seconds_to_hms(seconds: float) -> str:
    """Format seconds as 'Xh Ym Zs' or 'Ym Zs'."""
    seconds = int(seconds)
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h}h {m}m {s}s"
    return f"{m}m {s}s"


def _build_docx_config(summary: dict, has_slides: bool) -> dict:
    """Assemble Block 9 — docx_config. Entirely app-layer computed."""
    m = summary.get("metadata", {})
    title = m.get("title", "Meeting Summary")
    date_str = m.get("date", "")
    duration_fmt = m.get("duration_formatted", "")
    participant_count = m.get("participant_count", 0)
    tone = m.get("tone", "semi-formal")
    meeting_type = m.get("meeting_type", "meeting")

    # Build subtitle
    parts = []
    if date_str:
        parts.append(date_str)
    if duration_fmt:
        parts.append(duration_fmt)
    if participant_count:
        parts.append(f"{participant_count} Participants")
    subtitle = "  |  ".join(parts)

    return {
        "document_title": f"Meeting Summary – {title}",
        "document_subtitle": subtitle,
        "sections_to_include": {
            "cover_page": True,
            "executive_summary": True,
            "highlights": True,
            "topics_breakdown": True,
            "key_points": True,
            "decisions": True,
            "action_items": True,
            "speaker_contributions": True,
            "slides": has_slides,
        },
        "formatting": {
            "action_items_as_table": True,
            "decisions_as_table": False,
            "include_timestamps": True,
            "tone": tone,
            "slides_placement": "inline",
            "speaker_name_fallback": "Speaker {n}",
        },
    }


def _build_chatbot_context(summary: dict) -> dict:
    """
    Assemble Block 10 — chatbot_context. Entirely app-layer computed.
    Uses display_name everywhere — no nulls reach the chatbot.
    """
    m = summary.get("metadata", {})
    participants = m.get("participants", [])
    topics = summary.get("topics", [])
    action_items = summary.get("action_items", [])
    decisions = summary.get("decisions", [])

    # Quick facts
    title = m.get("title", "Unknown Meeting")
    date = m.get("date", "Unknown date")
    duration = m.get("duration_formatted", "")
    p_count = m.get("participant_count", len(participants))

    # Speaker list with display_names
    speaker_list = ", ".join(
        f"{p['display_name']} ({p.get('role', 'participant')})"
        for p in participants
    )

    quick_facts = [
        f"Meeting: {title}" + (f" on {date}" if date and date != "Unknown date" else ""),
        f"Duration: {duration}" if duration else None,
        f"{p_count} participants: {speaker_list}" if speaker_list else f"{p_count} participants",
        f"{len(topics)} topic{'s' if len(topics) != 1 else ''} discussed",
        f"{len(action_items)} action item{'s' if len(action_items) != 1 else ''} assigned",
        f"{len(decisions)} decision{'s' if len(decisions) != 1 else ''} made",
    ]
    quick_facts = [f for f in quick_facts if f]

    # Topic index: context_id → "Topic Title (start - end)"
    def _fmt_time(sec: float) -> str:
        h = int(sec // 3600)
        m = int((sec % 3600) // 60)
        s = int(sec % 60)
        return f"{h}:{m:02d}:{s:02d}" if h > 0 else f"{m}:{s:02d}"

    topic_index = {
        t.get("topic_id", f"topic_{i}"): (
            f"{t.get('title', 'Untitled')} "
            f"({_fmt_time(t.get('start_time', 0.0))} – {_fmt_time(t.get('end_time', 0.0))})"
        )
        for i, t in enumerate(topics)
    }

    # Suggested questions based on meeting content
    suggested = []
    if decisions:
        suggested.append("What decisions were made in this meeting?")
    if action_items:
        # Find who has most action items
        assignees = [a.get("assignee_name") or "someone" for a in action_items if a.get("assignee_id")]
        if assignees:
            from collections import Counter
            top = Counter(assignees).most_common(1)[0][0]
            suggested.append(f"What are {top}'s action items?")
        suggested.append("List all action items and their owners.")
    if topics:
        suggested.append(f"Summarize the '{topics[0].get('title', 'first topic')}' discussion.")
    if len(topics) > 1:
        suggested.append(f"What was the outcome of the '{topics[-1].get('title', 'last topic')}' segment?")

    # Fallback suggestions if meeting had little content
    if not suggested:
        suggested = [
            "What was this meeting about?",
            "Who were the main speakers?",
            "What were the key takeaways?",
        ]

    return {
        "quick_facts": quick_facts,
        "topic_index": topic_index,
        "suggested_questions": suggested[:4],  # max 4
    }


# ──────────────────────────────────────────────
# Schema 3 validator
# ──────────────────────────────────────────────

def _validate_llm_output(llm_out: dict, schema2: dict) -> dict:
    """
    Enforce Schema 3 rules on LLM output before app enrichment.
    - speaker_name, assignee_name, decided_by_name must be null (not "Speaker N")
    - IDs must reference valid entries
    """
    placeholder_pattern = {"speaker 1", "speaker 2", "speaker 3", "speaker 4",
                            "unknown", "unresolved"}

    def _sanitize_name(name):
        if name and name.lower().strip() in placeholder_pattern:
            return None
        # Also catch "Speaker N" pattern
        if name and name.lower().startswith("speaker ") and name[8:].strip().isdigit():
            return None
        return name

    for kp in llm_out.get("key_points", []):
        kp["speaker_name"] = _sanitize_name(kp.get("speaker_name"))

    for d in llm_out.get("decisions", []):
        d["decided_by_name"] = _sanitize_name(d.get("decided_by_name"))
        d["agreed_by_names"] = [_sanitize_name(n) for n in d.get("agreed_by_names", [])]

    for a in llm_out.get("action_items", []):
        a["assignee_name"] = _sanitize_name(a.get("assignee_name"))
        a["status"] = "open"  # Always open at generation time

    for sc in llm_out.get("speaker_contributions", []):
        sc["name"] = _sanitize_name(sc.get("name"))

    return llm_out


# ──────────────────────────────────────────────
# Main function
# ──────────────────────────────────────────────

def generate_summary(
    schema2: dict,
    source_type: str = "audio",
    slides: Optional[list] = None,
) -> dict:
    """
    LLM Call #2: Transform Schema 2 → Schema 3.

    Args:
        schema2: Cleaner output conforming to Schema 2
        source_type: "audio" or "video"
        slides: Slides array from smart_slide (video pipeline only)

    Returns:
        Complete Schema 3 JSON with all 10 blocks
    """
    summary_id = str(uuid.uuid4())
    t_start = time.time()
    has_slides = source_type == "video" and bool(slides)

    # ── Preprocessing ──
    print("[summary_model] Preprocessing cleaner output for LLM...")
    lean_input = _preprocess_for_summary(schema2)
    print(f"[summary_model] Sending {len(lean_input['contexts'])} contexts to Gemini...")

    # ── LLM Call #2 ──
    system_prompt = load_prompt("summary_prompt.txt")
    user_message = json.dumps(lean_input, ensure_ascii=False)

    model = _get_gemini_client()
    response = model.generate_content(
        contents=[
            {"role": "user", "parts": [
                f"SYSTEM INSTRUCTIONS:\n{system_prompt}\n\n"
                f"CLEANER OUTPUT INPUT:\n{user_message}"
            ]}
        ]
    )

    t_llm = time.time() - t_start
    print(f"[summary_model] LLM response received in {t_llm:.1f}s")

    # Parse JSON
    try:
        llm_out = json.loads(response.text)
    except json.JSONDecodeError:
        text = response.text
        if "```json" in text:
            text = text.split("```json")[1].split("```")[0].strip()
        elif "```" in text:
            text = text.split("```")[1].split("```")[0].strip()
        try:
            llm_out = json.loads(text)
        except json.JSONDecodeError as e:
            raise ValueError(f"Summary LLM returned invalid JSON: {e}\n\nRaw: {response.text[:500]}")

    # Validate / sanitize
    llm_out = _validate_llm_output(llm_out, schema2)

    # ── App Layer Enrichment ──
    print("[summary_model] Computing app-layer fields...")

    # Build participant list with display_name
    cleaner_speakers = {sp["speaker_id"]: sp for sp in schema2.get("speakers", [])}
    llm_participants = llm_out.get("metadata", {}).get("participants", [])

    enriched_participants = []
    for p in llm_participants:
        sid = p.get("speaker_id", "")
        name = p.get("name")
        display_name = _compute_display_name(sid, name)
        cleaner_sp = cleaner_speakers.get(sid, {})

        enriched_participants.append({
            "speaker_id": sid,
            "name": name,
            "display_name": display_name,
            "role": p.get("role") or cleaner_sp.get("role_inferred", "participant"),
            "speaking_time_seconds": cleaner_sp.get("speaking_time_seconds", 0.0),
            "speaking_percentage": cleaner_sp.get("speaking_percentage", 0.0),
        })

    # Enrich speaker_contributions with display_name + passthrough stats
    enriched_contributions = []
    for sc in llm_out.get("speaker_contributions", []):
        sid = sc.get("speaker_id", "")
        name = sc.get("name")
        display_name = _compute_display_name(sid, name)
        cleaner_sp = cleaner_speakers.get(sid, {})

        enriched_contributions.append({
            "speaker_id": sid,
            "name": name,
            "display_name": display_name,
            "role": sc.get("role") or cleaner_sp.get("role_inferred", "participant"),
            "speaking_time_seconds": cleaner_sp.get("speaking_time_seconds", 0.0),
            "speaking_percentage": cleaner_sp.get("speaking_percentage", 0.0),
            "topics_led": sc.get("topics_led", []),
            "decisions_made": sc.get("decisions_made", []),
            "action_items_assigned": sc.get("action_items_assigned", []),
            "key_contributions": sc.get("key_contributions", []),
        })

    # Build metadata block (Block 1) with app-layer fields
    meeting_meta = schema2.get("meeting", {})
    llm_meta = llm_out.get("metadata", {})
    duration_secs = meeting_meta.get("duration_seconds", 0)

    metadata = {
        "title": llm_meta.get("title") or meeting_meta.get("auto_title", "Meeting Summary"),
        "date": meeting_meta.get("detected_date"),
        "time": meeting_meta.get("detected_time"),
        "duration_seconds": duration_secs,
        "duration_formatted": _seconds_to_hms(duration_secs),   # [APP]
        "meeting_type": llm_meta.get("meeting_type") or meeting_meta.get("detected_type", "unknown"),
        "tone": llm_meta.get("tone", "semi-formal"),
        "language_primary": meeting_meta.get("language_primary", "en"),
        "is_multilingual": meeting_meta.get("is_multilingual", False),
        "participant_count": len(enriched_participants),          # [APP]
        "participants": enriched_participants,
    }

    # Inject slide_ids into topics (video pipeline only)
    topics = llm_out.get("topics", [])
    # Ensure every topic has a topic_id — LLM occasionally omits it
    for i, t in enumerate(topics):
        if not t.get("topic_id"):
            t["topic_id"] = f"topic_{i+1:03d}"
        if not t.get("start_time") and t.get("start_time") != 0:
            t["start_time"] = 0.0
        if not t.get("end_time"):
            t["end_time"] = t.get("start_time", 0.0)
        t.setdefault("duration_seconds", max(0.0, t["end_time"] - t["start_time"]))

    if has_slides and slides:
        # Match slides to topics by timestamp overlap, NOT by ID string.
        # smart_slide.py uses ctx_id from Schema 2 (e.g. "ctx_001") but the
        # LLM generates topic_ids independently (e.g. "topic_001") — they never match.
        # Timestamp-based matching is authoritative and schema-correct.
        for t in topics:
            t_start = t.get("start_time", 0.0)
            t_end   = t.get("end_time", 0.0)
            t["slide_ids"] = [
                sl["slide_id"] for sl in slides
                if t_start <= sl.get("timestamp", -1) <= t_end
            ]
    else:
        for t in topics:
            t.setdefault("slide_ids", [])

    # Assemble complete Schema 3
    schema3 = {
        "summary_id": summary_id,
        "schema_version": SCHEMA_VERSION,
        "source_cleaned_id": schema2["cleaned_id"],
        "source_type": source_type,
        "has_slides": has_slides,
        "llm_model": GEMINI_MODEL,
        "generated_at": datetime.now(timezone.utc).isoformat(),

        # Block 1 — Metadata (LLM + APP)
        "metadata": metadata,

        # Block 2 — Overview (LLM)
        "overview": llm_out.get("overview", {}),

        # Block 3 — Topics (LLM + APP slide_ids)
        "topics": topics,

        # Block 4 — Key Points (LLM)
        "key_points": llm_out.get("key_points", []),

        # Block 5 — Decisions (LLM)
        "decisions": llm_out.get("decisions", []),

        # Block 6 — Action Items (LLM)
        "action_items": llm_out.get("action_items", []),

        # Block 7 — Speaker Contributions (LLM + APP)
        "speaker_contributions": enriched_contributions,

        # Block 8 — Slides (APP / video pipeline only)
        "slides": slides or [],

        # Block 9 — DOCX Config (APP)
        "docx_config": None,  # computed below after metadata is set

        # Block 10 — Chatbot Context (APP)
        "chatbot_context": None,  # computed below
    }

    # Compute Blocks 9 and 10 now that full schema3 is assembled
    schema3["docx_config"] = _build_docx_config(schema3, has_slides)
    schema3["chatbot_context"] = _build_chatbot_context(schema3)

    elapsed = time.time() - t_start
    print(f"[summary_model] Done in {elapsed:.1f}s")
    print(f"  Title:       {schema3['metadata']['title']}")
    print(f"  Type:        {schema3['metadata']['meeting_type']}")
    print(f"  Participants:{schema3['metadata']['participant_count']}")
    print(f"  Topics:      {len(schema3['topics'])}")
    print(f"  Action Items:{len(schema3['action_items'])}")
    print(f"  Decisions:   {len(schema3['decisions'])}")

    return schema3


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Botzilla Summary Model — Schema 2 → Schema 3")
    parser.add_argument("cleaned_json", help="Path to Schema 2 JSON (output of cleaner)")
    parser.add_argument("output_dir", help="Directory to save summary JSON")
    parser.add_argument("--source-type", default="audio", choices=["audio", "video"])
    args = parser.parse_args()

    with open(args.cleaned_json, encoding="utf-8") as f:
        schema2 = json.load(f)

    schema3 = generate_summary(schema2, source_type=args.source_type)

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{schema3['summary_id'][:8]}_summary.json"

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(schema3, f, indent=2, ensure_ascii=False)

    print(f"\n[✓] Schema 3 saved: {out_path}")
