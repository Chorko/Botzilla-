"""
Botzilla — Chatbot (Tiered RAG)
Answers questions about meeting content using pre-computed Schema 3 JSON.

Three-tier routing (no LLM calls unless tier 3 needed):

  Tier 1 — JSON Lookup (instant, zero LLM)
    Keyword matching against chatbot_context quick_facts + topic_index.
    Confidence: 1.0 on exact match, 0.9 on keyword match.

  Tier 2 — TF-IDF Similarity (fast, zero LLM)
    Cosine similarity across topic summaries + key_points + decisions + action_items.
    Threshold: CHATBOT_CONFIDENCE_FALLBACK_THRESHOLD (default 0.75)
    If best score >= threshold → answer from relevant context chunks.

  Tier 3 — Gemini API Fallback (LLM, only when Tiers 1+2 both fail)
    Triggered when TF-IDF best score < 0.75.
    Uses chatbot_context + top-N topic summaries as system context.
    Answers in the meeting's language (Hinglish/Tanglish preserved).
"""

import sys
import json
import re
from pathlib import Path
from typing import Optional

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from config.settings import (
    GEMINI_API_KEY,
    GEMINI_MODEL,
    CHATBOT_CONFIDENCE_FALLBACK_THRESHOLD,
    CHATBOT_GEMINI_CONTEXT_CHUNKS,
)


# ──────────────────────────────────────────────
# Data model
# ──────────────────────────────────────────────

class ChatbotAnswer:
    """Structured answer from any tier."""
    def __init__(
        self,
        answer: str,
        confidence: float,
        tier: int,
        sources: list = None,
    ):
        self.answer = answer
        self.confidence = confidence
        self.tier = tier
        self.sources = sources or []

    def to_dict(self) -> dict:
        return {
            "answer": self.answer,
            "confidence": round(self.confidence, 3),
            "tier": self.tier,
            "tier_name": ["", "JSON Lookup", "TF-IDF", "Gemini"][self.tier],
            "sources": self.sources,
        }


# ──────────────────────────────────────────────
# Botzilla Chatbot
# ──────────────────────────────────────────────

class BotzillaChatbot:
    """
    Load a Schema 3 summary JSON and answer questions about the meeting.
    Instantiate once per meeting, call .ask() for each query.
    """

    def __init__(self, summary_json: dict):
        self.summary = summary_json
        self.ctx = summary_json.get("chatbot_context", {})
        self.topics = summary_json.get("topics", [])
        self.key_points = summary_json.get("key_points", [])
        self.decisions = summary_json.get("decisions", [])
        self.action_items = summary_json.get("action_items", [])
        self.participants = summary_json.get("metadata", {}).get("participants", [])
        self.meeting_type = summary_json.get("metadata", {}).get("meeting_type", "meeting")

        # Pre-build display_name lookup
        self._names = {
            p["speaker_id"]: p["display_name"]
            for p in self.participants
        }

        # Pre-build TF-IDF corpus
        self._corpus = []
        self._corpus_meta = []  # (type, id, raw_obj)
        self._build_corpus()

        # Lazy Gemini client
        self._gemini_client = None

    def _dn(self, speaker_id: str) -> str:
        """Resolve display_name from speaker_id."""
        return self._names.get(speaker_id, speaker_id)

    def _build_corpus(self):
        """Build text corpus for TF-IDF from all meeting content."""
        # Topic summaries
        for t in self.topics:
            text = f"{t['title']}. {t.get('summary', '')}"
            self._corpus.append(text)
            self._corpus_meta.append(("topic", t["topic_id"], t))

        # Key points
        for kp in self.key_points:
            speaker = kp.get("speaker_name") or self._dn(kp.get("speaker_id", ""))
            text = f"{kp['text']} {speaker}"
            self._corpus.append(text)
            self._corpus_meta.append(("key_point", kp["point_id"], kp))

        # Decisions
        for d in self.decisions:
            by = d.get("decided_by_name") or self._dn(d.get("decided_by_id", ""))
            text = f"Decision: {d['text']} decided by {by}"
            self._corpus.append(text)
            self._corpus_meta.append(("decision", d["decision_id"], d))

        # Action items
        for a in self.action_items:
            assignee = a.get("assignee_name") or self._dn(a.get("assignee_id", ""))
            due = f"due {a['due_date']}" if a.get("due_date") else ""
            text = f"Action item: {a['text']} assigned to {assignee} {due}"
            self._corpus.append(text)
            self._corpus_meta.append(("action_item", a["action_id"], a))

        # Quick facts as additional context
        for fact in self.ctx.get("quick_facts", []):
            self._corpus.append(fact)
            self._corpus_meta.append(("quick_fact", "qf", fact))

    # ── Tier 1: JSON Lookup ──────────────────

    def _tier1_lookup(self, query: str) -> Optional[ChatbotAnswer]:
        """
        Exact / keyword match against known structured data.
        Handles common intent patterns:
          - "action items" / "who is responsible" / "tasks"
          - "decisions" / "what was decided"
          - "speakers" / "who spoke"
          - "summary" / "what was this about"
          - speaker name mentions → their contributions
        """
        q = query.lower().strip()

        # Intent: list all action items
        if any(p in q for p in ["action item", "task", "follow up", "to do", "todo"]):
            if not self.action_items:
                return ChatbotAnswer("No action items were recorded in this meeting.", 1.0, 1)
            lines = []
            for a in self.action_items:
                assignee = a.get("assignee_name") or self._dn(a.get("assignee_id", ""))
                due = f" (due {a['due_date']})" if a.get("due_date") else ""
                pri = f" [{a['priority'].upper()}]" if a.get("priority") else ""
                lines.append(f"• {a['text']} → {assignee}{due}{pri}")
            return ChatbotAnswer("\n".join(lines), 1.0, 1, ["action_items"])

        # Intent: list all decisions
        if any(p in q for p in ["decision", "decided", "agreed", "conclusion"]):
            if not self.decisions:
                return ChatbotAnswer("No decisions were recorded in this meeting.", 1.0, 1)
            lines = []
            for d in self.decisions:
                by = d.get("decided_by_name") or self._dn(d.get("decided_by_id", ""))
                lines.append(f"• {d['text']}" + (f" (decided by {by})" if by else ""))
            return ChatbotAnswer("\n".join(lines), 1.0, 1, ["decisions"])

        # Intent: who spoke / participants / speakers
        if any(p in q for p in ["who spoke", "speaker", "participant", "who was there", "who attended"]):
            parts = []
            for p in self.participants:
                time_fmt = ""
                t = p.get("speaking_time_seconds", 0)
                if t:
                    mins = int(t // 60)
                    secs = int(t % 60)
                    time_fmt = f" — {mins}m {secs}s ({p.get('speaking_percentage', 0):.1f}%)"
                parts.append(f"• {p['display_name']} ({p.get('role', 'participant')}){time_fmt}")
            return ChatbotAnswer("\n".join(parts), 1.0, 1, ["participants"])

        # Intent: overall summary / what was this about
        if any(p in q for p in ["what was this", "what happened", "overview", "summary", "about this meeting"]):
            overview = self.summary.get("overview", {})
            exec_sum = overview.get("executive_summary", "")
            if exec_sum:
                return ChatbotAnswer(exec_sum, 1.0, 1, ["overview"])

        # Intent: topics / agenda
        if any(p in q for p in ["topic", "agenda", "what was discussed", "what was covered"]):
            lines = []
            for t in self.topics:
                dur = int(t["duration_seconds"] // 60)
                lines.append(f"• {t['title']} (~{dur}m)")
            return ChatbotAnswer("Topics discussed:\n" + "\n".join(lines), 1.0, 1, ["topics"])

        # Intent: specific speaker name mentioned in query
        for p in self.participants:
            name = p["display_name"]
            if name.lower() in q:
                # Find their contributions
                contrib = next(
                    (sc for sc in self.summary.get("speaker_contributions", [])
                     if sc["speaker_id"] == p["speaker_id"]),
                    None,
                )
                if contrib:
                    contributions = contrib.get("key_contributions", [])
                    items = [f"• {c}" for c in contributions]
                    # Also find their action items
                    their_actions = [
                        a for a in self.action_items
                        if a.get("assignee_id") == p["speaker_id"]
                    ]
                    if their_actions:
                        items.append(f"\nAction items assigned to {name}:")
                        for a in their_actions:
                            items.append(f"  → {a['text']}")
                    if items:
                        return ChatbotAnswer("\n".join(items), 0.95, 1, [p["speaker_id"]])

        return None  # No match — escalate to Tier 2

    # ── Tier 2: TF-IDF ──────────────────────

    def _tier2_tfidf(self, query: str) -> ChatbotAnswer:
        """
        TF-IDF cosine similarity across the corpus.
        Returns best matching content chunks with a confidence score.
        """
        if not self._corpus:
            return ChatbotAnswer("I don't have enough context to answer that.", 0.0, 2)

        try:
            vectorizer = TfidfVectorizer(ngram_range=(1, 2), stop_words="english")
            corpus_plus_query = self._corpus + [query]
            tfidf_matrix = vectorizer.fit_transform(corpus_plus_query)

            # Query is the last row; corpus is all other rows
            query_vec = tfidf_matrix[-1]
            corpus_vecs = tfidf_matrix[:-1]
            scores = cosine_similarity(query_vec, corpus_vecs).flatten()

            # Get top-4 matches
            top_indices = scores.argsort()[-4:][::-1]
            best_score = float(scores[top_indices[0]])

            if best_score < 0.05:
                # Essentially no match
                return ChatbotAnswer("I couldn't find relevant information for that question.", best_score, 2)

            # Build answer from top matches
            answer_parts = []
            sources = []
            for idx in top_indices:
                if scores[idx] < 0.05:
                    break
                mtype, mid, mobj = self._corpus_meta[idx]
                sources.append(f"{mtype}:{mid}")

                if mtype == "topic":
                    answer_parts.append(f"**{mobj['title']}**: {mobj.get('summary', '')}")
                elif mtype == "key_point":
                    speaker = mobj.get("speaker_name") or self._dn(mobj.get("speaker_id", ""))
                    ts = mobj.get("timestamp", 0)
                    m, s = int(ts // 60), int(ts % 60)
                    by = f" — {speaker} ({m}:{s:02d})" if speaker else ""
                    answer_parts.append(f"• {mobj['text']}{by}")
                elif mtype == "decision":
                    by = mobj.get("decided_by_name") or self._dn(mobj.get("decided_by_id", ""))
                    answer_parts.append(f"Decision: {mobj['text']}" + (f" (by {by})" if by else ""))
                elif mtype == "action_item":
                    assignee = mobj.get("assignee_name") or self._dn(mobj.get("assignee_id", ""))
                    answer_parts.append(f"Action: {mobj['text']}" + (f" → {assignee}" if assignee else ""))
                elif mtype == "quick_fact":
                    answer_parts.append(str(mobj))

            answer = "\n".join(answer_parts)
            return ChatbotAnswer(answer, best_score, 2, sources)

        except Exception as e:
            return ChatbotAnswer(f"Search error: {e}", 0.0, 2)

    # ── Tier 3: Gemini Fallback ──────────────

    def _tier3_gemini(self, query: str) -> ChatbotAnswer:
        """
        Gemini API fallback — uses chatbot_context + top topic summaries as context.
        Only called when Tier 1 and Tier 2 both fail to meet the threshold.
        """
        import google.generativeai as genai

        if not GEMINI_API_KEY:
            return ChatbotAnswer(
                "I don't have enough information to answer that question from the meeting transcript.",
                0.0, 3
            )

        # Build context for Gemini
        context_parts = []

        # Quick facts
        context_parts.append("MEETING QUICK FACTS:")
        context_parts.extend(self.ctx.get("quick_facts", []))

        # Top topic summaries (limited to CHATBOT_GEMINI_CONTEXT_CHUNKS)
        context_parts.append("\nTOPIC SUMMARIES:")
        for t in self.topics[:CHATBOT_GEMINI_CONTEXT_CHUNKS]:
            context_parts.append(f"- {t['title']}: {t.get('summary', '')}")

        # Decisions
        if self.decisions:
            context_parts.append("\nDECISIONS MADE:")
            for d in self.decisions:
                context_parts.append(f"- {d['text']}")

        # Action items
        if self.action_items:
            context_parts.append("\nACTION ITEMS:")
            for a in self.action_items:
                assignee = a.get("assignee_name") or self._dn(a.get("assignee_id", ""))
                context_parts.append(f"- {a['text']} → {assignee}")

        context_str = "\n".join(context_parts)

        system_prompt = (
            "You are Botzilla, a meeting assistant. Answer questions about the meeting "
            "using ONLY the provided context. Be direct and concise (1-3 sentences). "
            "Respond in the same language/style as the question. "
            "If the information is not in the context, say 'That information isn't available in the meeting transcript.'"
        )

        try:
            if not self._gemini_client:
                genai.configure(api_key=GEMINI_API_KEY)
                self._gemini_client = genai.GenerativeModel(
                    model_name=GEMINI_MODEL,
                    generation_config=genai.GenerationConfig(temperature=0.2),
                )

            response = self._gemini_client.generate_content(
                contents=[
                    {"role": "user", "parts": [
                        f"{system_prompt}\n\nCONTEXT:\n{context_str}\n\nQUESTION: {query}\n\nANSWER:"
                    ]}
                ]
            )
            return ChatbotAnswer(response.text.strip(), 0.8, 3, ["gemini_fallback"])

        except Exception as e:
            return ChatbotAnswer(
                f"I encountered an error answering your question: {e}",
                0.0, 3
            )

    # ── Public API ───────────────────────────

    def ask(self, query: str) -> dict:
        """
        Answer a question about the meeting.

        Returns a dict with: answer, confidence, tier, tier_name, sources
        """
        if not query or not query.strip():
            return ChatbotAnswer("Please ask a question about the meeting.", 0.0, 1).to_dict()

        # Tier 1: JSON Lookup
        result = self._tier1_lookup(query)
        if result and result.confidence >= CHATBOT_CONFIDENCE_FALLBACK_THRESHOLD:
            return result.to_dict()

        # Tier 2: TF-IDF
        result2 = self._tier2_tfidf(query)
        if result2.confidence >= CHATBOT_CONFIDENCE_FALLBACK_THRESHOLD:
            return result2.to_dict()

        # If Tier 1 had a partial result, prefer it over a weak Tier 2
        if result and result.confidence > result2.confidence:
            if result.confidence >= 0.5:
                return result.to_dict()

        # Tier 3: Gemini fallback
        print(f"[chatbot] Low confidence ({result2.confidence:.2f}) — escalating to Gemini")
        return self._tier3_gemini(query).to_dict()

    def get_suggested_questions(self) -> list:
        """Return pre-computed suggested questions from chatbot_context."""
        return self.ctx.get("suggested_questions", [])


# ──────────────────────────────────────────────
# CLI / Interactive Mode
# ──────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Botzilla Chatbot — query a meeting summary")
    parser.add_argument("summary_json", help="Path to Schema 3 summary JSON")
    parser.add_argument("--query", "-q", default=None, help="Single query (non-interactive)")
    args = parser.parse_args()

    with open(args.summary_json, encoding="utf-8") as f:
        summary = json.load(f)

    bot = BotzillaChatbot(summary)

    print(f"\n⚡ Botzilla Chatbot")
    print(f"   Meeting: {summary['metadata']['title']}")
    print(f"\nSuggested questions:")
    for q in bot.get_suggested_questions():
        print(f"  • {q}")
    print()

    if args.query:
        result = bot.ask(args.query)
        print(f"Q: {args.query}")
        print(f"A: {result['answer']}")
        print(f"   [Tier {result['tier']}: {result['tier_name']}, confidence: {result['confidence']:.2f}]")
    else:
        # Interactive REPL
        print("Type your question (or 'exit' to quit):\n")
        while True:
            try:
                query = input("You: ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\nGoodbye!")
                break
            if query.lower() in {"exit", "quit", "q"}:
                break
            if not query:
                continue
            result = bot.ask(query)
            print(f"Botzilla: {result['answer']}")
            print(f"          [Tier {result['tier']}: {result['tier_name']}, confidence: {result['confidence']:.2f}]\n")
