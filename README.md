<div align="center">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:000000,100:8B4513&height=200&section=header&text=Botzilla&fontSize=80&fontAlignY=35&animation=twinkling&fontColor=ffffff" alt="Botzilla Banner" />

  <a href="https://github.com/rahul14rx/capegemini_final">
    <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=22&pause=1000&color=C4A484&center=true&vCenter=true&width=800&lines=Multimodal+Meeting+Intelligence.;Trimodal+Audio/Video/Text+Fusion.;Agentic+Execution+via+Gemini+2.5+Flash." alt="Typing SVG" />
  </a>
</div>

<p align="center">
  <b>A deep technical architecture executing a dual-pipeline multimodal fusion strategy. We parallelize Audio and Video processing into a strictly structured 3-Schema JSON pipeline, finalized by an Agentic Execution engine.</b>
</p>

<div align="center">
  <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white">
  <img src="https://img.shields.io/badge/Express.js-404D59?style=for-the-badge&logo=express">
  <img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white">
  <img src="https://img.shields.io/badge/FFmpeg-007808?style=for-the-badge&logo=ffmpeg&logoColor=white">
  <img src="https://img.shields.io/badge/PyTorch-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white">
  <img src="https://img.shields.io/badge/Gemini_AI-8E75B2?style=for-the-badge&logo=googlebard&logoColor=white">
  <img src="https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white">
</div>

---

<h2 style="color: #8B4513;">Architecture Diagram</h2>

<img width="1620" height="912" alt="Screenshot 2026-06-15 081550" src="https://github.com/user-attachments/assets/7f83c35c-fc32-4bc3-a56b-d7837d106ce7" />

---

<h2 style="color: #8B4513;"> The 7-Phase Methodology Pipeline</h2>

Botzilla diverges from standard linear summarization by explicitly forking the workload into a synchronized trilateral execution path.

```mermaid
graph TD
    A[Phase 1: Ingestion / FastAPI] --> B[Phase 2: Smart Splitter & Pre-processing]
    
    B -->|WAV 16kHz| C[Phase 3: Transcription & Diarization <br> WhisperX + Pyannote 3.1]
    B -->|Visual Frames| D[Phase 4: Visual OCR & PNG Extraction <br> FFmpeg + Tesseract]
    
    C -->|Schema 1 Raw JSON| E[Phase 5: Agentic Cleaning <br> LLM Call 1]
    
    E -->|Schema 2 Timestamps| D
    D -->|OCR Text & Slide PNG Paths| F[Phase 6: Summary Generation <br> LLM Call 2]
    E -->|Cleaned Audio Context| F
    
    F -->|Blocks 1-8 Insights| G[Phase 7: Compilation & App Layer]
    G -->|Appends Blocks 9 & 10| H[Schema 3 Final Output]
    H --> I[Embedded DOCX / React UI JSON / TF-IDF Index]
```

---

<h2 style="color: #8B4513;"> Core Innovations</h2>

* **Dual-Agent Sequencing:** We decoupled LLM calls. Call #1 (Cleaner) filters noise and calculates `pause_before_seconds` boundaries. Call #2 (Summary) executes purely on sanitized data yielding high-fidelity insights.

* **Token Payload Optimization (300% Reduction):** By using segment-level timestamps instead of word-level, and stripping hardware logs before Call #1, we drastically reduced LLM context windows while maintaining strict forensic auditability.

* **Native Visual Embedding:** Our Node.js compilation layer dynamically stitches physical slide PNGs directly into the generated DOCX artifacts (either inline or clustered in an appendix).

* **Native Hinglish Resilience:** Engineered to avoid brittle translation layers. By flagging (`is_filler_only = true`) instead of translating, we preserve localized slang and critical meeting sentiment.

---

<h2 style="color: #8B4513;"> Challenges Overcome</h2>

| Challenge | Resolution Architecture |
| :--- | :--- |
| **Diarization Drift** <br> *(Overlapping speech fragmentation)* | Implemented `VERY_SHORT_SEGMENT_THRESHOLD = 0.5s` and `LOW_CONFIDENCE_THRESHOLD = 0.70` to discard sub-second fragmented overlaps before they poison the LLM context. |
| **Hinglish Context Loss** <br> *(Lost intent via translation)* | Curated a localized filler word registry. Flagged segments bypass translation to ensure the Summary Model receives raw, sentiment-accurate domains slang. |
| **Visual Context Gap** <br> *("As you can see on this chart...")* | Engineered a smart FFmpeg scene-detection pipeline (`0.02 SCENE_CHANGE_THRESHOLD`, `-fps_mode vfr`) to catch un-announced slide transitions and force them into the OCR and DOCX pipeline. |

---

<h2 style="color: #8B4513;"> Environment Execution & Run Commands</h2>

Follow this execution order to initialize both backend runtimes locally.

<h3 style="color: #8B4513;">1. Python Engine Setup</h3>
Install the necessary processing tools and runtime libraries inside the worker directory.

```bash
cd videoocr
pip install -r requirements.txt
```

<h3 style="color: #8B4513;">2. Node.js Application Layer Setup</h3>
Navigate to the application routing directory to download engine modules and launch the development pipeline tracker.

```bash
cd Botzilla
npm install
npm run dev
```

---
<div align="center">
  <i>Engineered for the Capgemini Exceller AgentifAI Buildathon Final Phase.</i>
</div>
