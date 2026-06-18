#!/usr/bin/env node
/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║         BOTZILLA — Meeting Summary DOCX Generator        ║
 * ║  Converts Summary JSON → professional Word document      ║
 * ╠══════════════════════════════════════════════════════════╣
 * ║  Usage (CLI):                                            ║
 * ║    node generate_docx.js <summary.json> [output.docx]   ║
 * ║                                                          ║
 * ║  Usage (module):                                         ║
 * ║    const { generateDocx } = require('./generate_docx')   ║
 * ║    const buffer = await generateDocx(summaryObject)      ║
 * ║    fs.writeFileSync('out.docx', buffer)                  ║
 * ╚══════════════════════════════════════════════════════════╝
 */

'use strict';

const {
  Document, Packer, Paragraph, TextRun,
  Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, LevelFormat,
  TabStopType, TabStopPosition,
  HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, PageBreak,
} = require('docx');

const fs   = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// COLOR PALETTE  (rich, modern, accessible)
// ─────────────────────────────────────────────────────────────

const C = {
  // Primary brand
  navy:       '1A2E4A',   // deep navy — H1 headings, cover title
  indigo:     '2D4A8A',   // indigo blue — section banners, sub-headings
  indigoBg:   'EDF2FF',   // very light indigo — section banner background
  
  // Accents
  teal:       '0A7C6E',   // teal — highlight callouts, overview
  tealBg:     'E6F7F5',   // light teal — overview / highlight bg
  tealDark:   '065E53',   // dark teal — overview header text
  
  // Table headers
  tableHdr:   '1A2E4A',   // navy — table header bg
  tableHdrTxt:'FFFFFF',   // white — table header text
  rowAlt:     'F7F9FC',   // subtle alt row
  rowWhite:   'FFFFFF',
  
  // Status / Priority
  red:        'C0392B',   // high priority
  redBg:      'FDECEA',   // high priority bg
  amber:      'B7770D',   // medium priority (dark for contrast)
  amberBg:    'FEF3CD',   // medium priority bg
  green:      '1A7A4A',   // low priority / positive
  greenBg:    'E8F5EE',   // low priority bg
  
  // Neutral
  darkText:   '1C1C1E',   // near-black body
  midText:    '4A4A5A',   // secondary text
  grey:       '7A7A8C',   // captions / metadata
  border:     'D0D5E8',   // subtle border
  midGrey:    'B0B8CC',   // divider
  divider:    'E8EBF5',   // very light divider
  white:      'FFFFFF',
  pageNum:    '8A8FA8',   // page number
};

// US Letter, 1-inch margins, content width in DXA (1440 DXA = 1 inch)
const PAGE = { w: 12240, h: 15840, margin: 1440, content: 9360 };

const CELL_MARGINS_TIGHT = { top: 60,  bottom: 60,  left: 100, right: 100 };
const CELL_MARGINS       = { top: 100, bottom: 100, left: 140, right: 140 };
const CELL_MARGINS_WIDE  = { top: 140, bottom: 140, left: 180, right: 180 };

const bdr = (color = C.border) => ({ style: BorderStyle.SINGLE, size: 1, color });
const noBdr = () => ({ style: BorderStyle.NONE, size: 0, color: C.white });
const ALL_BORDERS  = (color = C.border) => ({ top: bdr(color), bottom: bdr(color), left: bdr(color), right: bdr(color) });
const NO_BORDERS   = { top: noBdr(), bottom: noBdr(), left: noBdr(), right: noBdr() };

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

function fmt(sec) {
  if (sec == null || isNaN(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${z(m)}:${z(s)}` : `${m}:${z(s)}`;
}
function z(n) { return String(n).padStart(2, '0'); }

function dn(speakerId, participants = []) {
  if (!speakerId) return '';
  const p = participants.find(x => x.speaker_id === speakerId);
  if (!p) return speakerId;
  if (p.display_name) return p.display_name;
  if (p.name)         return p.name;
  return `Speaker ${parseInt((speakerId.match(/\d+$/) || ['0'])[0], 10) + 1}`;
}

function priColor(p) {
  return { high: C.red, medium: C.amber, low: C.green }[p] || C.grey;
}
function priBg(p) {
  return { high: C.redBg, medium: C.amberBg, low: C.greenBg }[p] || C.rowAlt;
}
function priLabel(p) {
  return { high: '● High', medium: '● Medium', low: '● Low' }[p] || (p || '—');
}

function cap(str) {
  if (!str) return '';
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function readImg(imgPath) {
  try {
    if (!imgPath) return null;
    const resolved = path.isAbsolute(imgPath) ? imgPath : path.resolve(process.cwd(), imgPath);
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved);
  } catch { return null; }
}

function imgType(imgPath) {
  const ext = (imgPath || '').split('.').pop().toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext) ? ext : 'png';
}

function labels(tone, meetingType) {
  const casual = tone === 'casual' || ['casual', 'game_session'].includes(meetingType);
  return {
    execSummary:  casual ? 'What Was This About?'  : 'Executive Summary',
    highlights:   casual ? 'Key Moments'           : 'Highlights',
    topics:       casual ? 'What Happened'         : 'Topics Discussed',
    keyPoints:    casual ? 'Notable Points'        : 'Key Points',
    decisions:    casual ? 'Things Decided'        : 'Decisions Made',
    actionItems:  casual ? "What's Next"           : 'Action Items',
    speakers:     casual ? 'Who Was There'         : 'Speaker Contributions',
    slides:       casual ? 'Screenshots'           : 'Slides & Screen Captures',
    noDecisions:  casual ? 'Nothing to decide.'    : 'No decisions were recorded.',
    noActions:    casual ? 'No follow-ups needed.' : 'No action items were assigned.',
    noKeyPoints:  casual ? 'Nothing notable.'      : 'No key points extracted.',
  };
}

// ─────────────────────────────────────────────────────────────
// PARAGRAPH / TABLE FACTORIES
// ─────────────────────────────────────────────────────────────

function p(text, {
  bold = false, italic = false, size = 22,
  color = C.darkText, align = AlignmentType.LEFT,
  before = 0, after = 100,
  bullet = false, numbered = false,
  pageBreak = false,
} = {}) {
  return new Paragraph({
    children: [new TextRun({ text: String(text ?? ''), bold, italic, size, color, font: 'Calibri' })],
    alignment: align,
    spacing: { before, after },
    ...(bullet   && { numbering: { reference: 'bullets', level: 0 } }),
    ...(numbered && { numbering: { reference: 'numbers', level: 0 } }),
    ...(pageBreak && { pageBreakBefore: true }),
  });
}

function spacer(n = 1) {
  return new Paragraph({ children: [new TextRun('')], spacing: { after: 120 * n } });
}

/** Section banner — full-width shaded heading (replaces plain H1) */
function sectionBanner(text) {
  return new Table({
    width: { size: PAGE.content, type: WidthType.DXA },
    columnWidths: [PAGE.content],
    borders: NO_BORDERS,
    rows: [new TableRow({
      children: [new TableCell({
        borders: NO_BORDERS,
        shading: { fill: C.indigoBg, type: ShadingType.CLEAR },
        margins: { top: 140, bottom: 140, left: 220, right: 220 },
        children: [new Paragraph({
          children: [new TextRun({
            text: text.toUpperCase(),
            font: 'Calibri', size: 26, bold: true, color: C.indigo,
          })],
          spacing: { before: 0, after: 0 },
        })],
      })],
    })],
  });
}

/** H2 — topic heading with timestamp */
function h2(text, startTime, endTime) {
  const tsText = startTime != null ? `   ${fmt(startTime)} – ${fmt(endTime)}` : '';
  return new Paragraph({
    children: [
      new TextRun({ text, font: 'Calibri', size: 26, bold: true, color: C.navy }),
      ...(tsText ? [new TextRun({ text: tsText, font: 'Calibri', size: 18, italic: true, color: C.grey })] : []),
    ],
    spacing: { before: 320, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 3, color: C.divider, space: 1 } },
  });
}

/** H3 — sub-section label */
function h3(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Calibri', size: 22, bold: true, color: C.indigo })],
    spacing: { before: 200, after: 60 },
  });
}

/** Teal highlight callout box */
function highlightBox(children) {
  return new Table({
    width: { size: PAGE.content, type: WidthType.DXA },
    columnWidths: [PAGE.content],
    borders: NO_BORDERS,
    rows: [new TableRow({
      children: [new TableCell({
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 2, color: C.border },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: C.border },
          left:   { style: BorderStyle.SINGLE, size: 18, color: C.teal },
          right:  noBdr(),
        },
        shading: { fill: C.tealBg, type: ShadingType.CLEAR },
        margins: CELL_MARGINS_WIDE,
        children,
      })],
    })],
  });
}

/** Generic callout / note box */
function callout(children, { bg = C.rowAlt, accent = C.indigo } = {}) {
  return new Table({
    width: { size: PAGE.content, type: WidthType.DXA },
    columnWidths: [PAGE.content],
    borders: NO_BORDERS,
    rows: [new TableRow({
      children: [new TableCell({
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 2, color: C.border },
          bottom: { style: BorderStyle.SINGLE, size: 2, color: C.border },
          left:   { style: BorderStyle.SINGLE, size: 14, color: accent },
          right:  noBdr(),
        },
        shading: { fill: bg, type: ShadingType.CLEAR },
        margins: CELL_MARGINS,
        children,
      })],
    })],
  });
}

/** Priority pill cell */
function priCell(priority, width, rowBg) {
  const label = priLabel(priority);
  const color = priColor(priority);
  return new TableCell({
    borders: ALL_BORDERS(C.border),
    width: { size: width, type: WidthType.DXA },
    shading: { fill: rowBg, type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: [new TextRun({ text: label, font: 'Calibri', size: 19, bold: true, color })],
    })],
  });
}

/** Table header cell */
function hCell(text, width) {
  return new TableCell({
    borders: ALL_BORDERS(C.tableHdr),
    width: { size: width, type: WidthType.DXA },
    shading: { fill: C.tableHdr, type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    children: [new Paragraph({
      children: [new TextRun({ text, font: 'Calibri', size: 20, bold: true, color: C.tableHdrTxt })],
    })],
  });
}

/** Table data cell */
function dCell(text, width, { bg = C.rowWhite, color = C.darkText, bold = false, size = 20, align = AlignmentType.LEFT } = {}) {
  return new TableCell({
    borders: ALL_BORDERS(C.border),
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text: String(text ?? '—'), font: 'Calibri', size, bold, color })],
    })],
  });
}

/** Slide image + caption block */
function slideBlock(slide, incTimestamps) {
  const elems = [];
  const imgData = readImg(slide.image_path);

  if (imgData) {
    elems.push(new Paragraph({
      children: [new ImageRun({
        type: imgType(slide.image_path),
        data: imgData,
        transformation: { width: 560, height: 315 },
        altText: {
          title: `Screen capture at ${fmt(slide.timestamp)}`,
          description: slide.ocr_text || '',
          name: slide.slide_id,
        },
      })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 60 },
    }));
  } else {
    elems.push(callout([
      p(`📷  Slide image not available: ${slide.image_path || slide.slide_id}`, { italic: true, color: C.grey, size: 18 }),
    ], { bg: C.rowAlt, accent: C.midGrey }));
  }

  if (incTimestamps && slide.timestamp != null) {
    elems.push(p(`Captured at ${fmt(slide.timestamp)}`, {
      italic: true, color: C.grey, size: 17, align: AlignmentType.CENTER, after: 60,
    }));
  }

  if (slide.ocr_text) {
    elems.push(callout([
      p('Slide text extracted by OCR:', { bold: true, size: 18, color: C.indigo, after: 40 }),
      p(slide.ocr_text, { italic: true, color: C.midText, size: 18 }),
    ], { bg: C.indigoBg, accent: C.indigo }), spacer(1));
  }

  return elems;
}

// ─────────────────────────────────────────────────────────────
// STAT BAR — single-row summary stats for cover page
// ─────────────────────────────────────────────────────────────

function buildStatBar(stats) {
  // stats: [{label, value}, ...]
  const colW = Math.floor(PAGE.content / stats.length);
  return new Table({
    width: { size: PAGE.content, type: WidthType.DXA },
    columnWidths: stats.map(() => colW),
    borders: NO_BORDERS,
    rows: [new TableRow({
      children: stats.map(({ label, value }) => new TableCell({
        borders: {
          top: bdr(C.indigo), bottom: bdr(C.border), left: noBdr(), right: noBdr(),
        },
        shading: { fill: C.indigoBg, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 100, left: 120, right: 120 },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: String(value), font: 'Calibri', size: 32, bold: true, color: C.indigo })],
            spacing: { after: 30 },
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: label.toUpperCase(), font: 'Calibri', size: 15, bold: false, color: C.grey })],
            spacing: { after: 0 },
          }),
        ],
      })),
    })],
  });
}

// ─────────────────────────────────────────────────────────────
// SECTION BUILDERS
// ─────────────────────────────────────────────────────────────

function buildCoverPage(summary, L) {
  const m   = summary.metadata   || {};
  const o   = summary.overview   || {};
  const cfg = summary.docx_config || {};

  const title       = cfg.document_title || m.title || 'Meeting Summary';
  const typeLabel   = cap(m.meeting_type || 'Meeting');
  const dateStr     = m.date
    ? new Date(m.date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;
  const timeStr     = m.time || null;
  const dur         = m.duration_formatted || '';
  const pCount      = m.participant_count || (m.participants || []).length;
  const pNames      = (m.participants || [])
    .map(px => px.display_name || px.name || dn(px.speaker_id, m.participants || []))
    .join('   ·   ');

  const topicCount  = (summary.topics || []).length;
  const actionCount = (summary.action_items || []).length;
  const decCount    = (summary.decisions || []).length;

  const elems = [spacer(3)];

  // Brand badge
  elems.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'BOTZILLA  ·  AI MEETING INTELLIGENCE', font: 'Calibri', size: 18, bold: true, color: C.indigo })],
    spacing: { after: 80 },
  }));

  // Meeting type tag
  elems.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: typeLabel.toUpperCase(), font: 'Calibri', size: 19, bold: true, color: C.teal })],
    spacing: { after: 120 },
  }));

  // Main title
  elems.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: title, font: 'Calibri', size: 56, bold: true, color: C.navy })],
    spacing: { before: 0, after: 200 },
  }));

  // Thick accent divider
  elems.push(new Table({
    width: { size: PAGE.content, type: WidthType.DXA },
    columnWidths: [PAGE.content],
    borders: NO_BORDERS,
    rows: [new TableRow({
      children: [new TableCell({
        borders: { bottom: { style: BorderStyle.SINGLE, size: 12, color: C.indigo }, top: noBdr(), left: noBdr(), right: noBdr() },
        shading: { fill: C.white, type: ShadingType.CLEAR },
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
        children: [new Paragraph({ children: [] })],
      })],
    })],
  }));
  elems.push(spacer(1));

  // Date / Time / Duration meta line
  const metaParts = [dateStr, timeStr, dur ? `Duration: ${dur}` : null].filter(Boolean);
  if (metaParts.length) {
    elems.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: metaParts.join('   |   '), font: 'Calibri', size: 21, color: C.midText })],
      spacing: { after: 120 },
    }));
  }

  // Participant names
  if (pNames) {
    elems.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: pNames, font: 'Calibri', size: 20, italic: true, color: C.grey })],
      spacing: { after: 240 },
    }));
  }

  // Stat bar
  const stats = [
    { label: 'Topics',       value: topicCount  },
    { label: 'Participants', value: pCount       },
    { label: 'Action Items', value: actionCount  },
    { label: 'Decisions',    value: decCount     },
  ];
  elems.push(buildStatBar(stats), spacer(2));

  // Outcome + Sentiment badges
  if (o.outcome || o.sentiment) {
    elems.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        ...(o.outcome   ? [
          new TextRun({ text: 'Outcome: ',    font: 'Calibri', size: 20, bold: true, color: C.navy }),
          new TextRun({ text: cap(o.outcome), font: 'Calibri', size: 20, color: C.midText }),
          new TextRun({ text: '     ',        font: 'Calibri', size: 20 }),
        ] : []),
        ...(o.sentiment ? [
          new TextRun({ text: 'Sentiment: ',       font: 'Calibri', size: 20, bold: true, color: C.navy }),
          new TextRun({ text: cap(o.sentiment),    font: 'Calibri', size: 20, color: C.midText }),
        ] : []),
      ],
      spacing: { after: 300 },
    }));
  }

  elems.push(new Paragraph({ children: [new PageBreak()] }));
  return elems;
}

function buildOverview(summary, L) {
  const o = summary.overview || {};
  if (!o.executive_summary && !(o.highlights && o.highlights.length)) return [];

  const elems = [
    sectionBanner(L.execSummary),
    spacer(1),
  ];

  if (o.executive_summary) {
    elems.push(new Paragraph({
      children: [new TextRun({ text: o.executive_summary, font: 'Calibri', size: 23, color: C.darkText })],
      spacing: { before: 80, after: 180 },
    }));
  }

  if (o.purpose) {
    elems.push(new Paragraph({
      children: [
        new TextRun({ text: 'Purpose:  ', font: 'Calibri', size: 22, bold: true, color: C.navy }),
        new TextRun({ text: o.purpose,   font: 'Calibri', size: 22, color: C.darkText }),
      ],
      spacing: { after: 200 },
    }));
  }

  if (o.highlights && o.highlights.length > 0) {
    elems.push(
      highlightBox([
        new Paragraph({
          children: [new TextRun({ text: `✦  ${L.highlights}`, font: 'Calibri', size: 22, bold: true, color: C.tealDark })],
          spacing: { after: 100 },
        }),
        ...o.highlights.map(h =>
          new Paragraph({
            children: [
              new TextRun({ text: '✓  ', font: 'Calibri', size: 20, bold: true, color: C.teal }),
              new TextRun({ text: h,    font: 'Calibri', size: 21, color: C.darkText }),
            ],
            spacing: { before: 60, after: 60 },
          })
        ),
      ]),
      spacer(1),
    );
  }

  return elems;
}

function buildTopics(summary, L) {
  const { topics = [], key_points = [], decisions = [], action_items = [], slides = [], metadata = {}, has_slides, docx_config = {} } = summary;
  if (!topics.length) return [];

  const fmt_cfg      = docx_config.formatting || {};
  const inlineSlides = fmt_cfg.slides_placement !== 'appendix';
  const incTs        = fmt_cfg.include_timestamps !== false;
  const parts        = metadata.participants || [];

  const kpByTopic  = {};
  const decByTopic = {};
  const actByTopic = {};
  key_points.forEach(x   => (kpByTopic[x.topic_id]  ||= []).push(x));
  decisions.forEach(x    => (decByTopic[x.topic_id] ||= []).push(x));
  action_items.forEach(x => (actByTopic[x.topic_id] ||= []).push(x));

  const slideMap = {};
  slides.forEach(s => (slideMap[s.slide_id] = s));

  const elems = [sectionBanner(L.topics), spacer(1)];

  topics.forEach((topic, idx) => {
    elems.push(h2(`${idx + 1}.  ${topic.title}`, incTs ? topic.start_time : null, incTs ? topic.end_time : null));

    if (topic.topic_type) {
      elems.push(p(cap(topic.topic_type), { size: 17, color: C.teal, bold: true, after: 80 }));
    }

    if (topic.summary) {
      elems.push(new Paragraph({
        children: [new TextRun({ text: topic.summary, font: 'Calibri', size: 22, color: C.darkText })],
        spacing: { after: 160 },
      }));
    }

    // ── Inline slides ──
    if (inlineSlides && has_slides && topic.slide_ids && topic.slide_ids.length > 0) {
      const topicSlides = topic.slide_ids.map(id => slideMap[id]).filter(Boolean);
      if (topicSlides.length > 0) {
        elems.push(h3(L.slides));
        topicSlides.forEach(slide => elems.push(...slideBlock(slide, incTs)));
      }
    }

    // ── Key Points ──
    const kps = kpByTopic[topic.topic_id] || [];
    if (kps.length > 0) {
      elems.push(h3(L.keyPoints));
      kps.forEach(kp => {
        const speaker  = kp.speaker_name || dn(kp.speaker_id, parts);
        const tsLabel  = incTs && kp.timestamp ? `  (${fmt(kp.timestamp)})` : '';
        const impColor = kp.importance === 'high' ? C.navy : C.darkText;
        elems.push(new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [
            new TextRun({ text: kp.text, font: 'Calibri', size: 21, bold: kp.importance === 'high', color: impColor }),
            ...(speaker || tsLabel ? [new TextRun({ text: `  — ${[speaker, tsLabel].filter(Boolean).join('')}`, font: 'Calibri', size: 18, italic: true, color: C.grey })] : []),
          ],
          spacing: { before: 60, after: 60 },
        }));
      });
    }

    // ── Decisions ──
    const decs = decByTopic[topic.topic_id] || [];
    if (decs.length > 0) {
      elems.push(h3(L.decisions));
      decs.forEach(d => {
        const by     = d.decided_by_name || dn(d.decided_by_id, parts);
        const agreed = (d.agreed_by_names || []).map((n, i) => n || dn((d.agreed_by_ids || [])[i], parts)).filter(Boolean).join(', ');
        const ts     = incTs && d.timestamp ? ` (${fmt(d.timestamp)})` : '';
        elems.push(new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [
            new TextRun({ text: d.text, font: 'Calibri', size: 21, bold: true, color: C.navy }),
            new TextRun({ text: `  ${[by && `Decided by ${by}`, agreed && `Agreed by ${agreed}`, ts].filter(Boolean).join(' · ')}`, font: 'Calibri', size: 18, italic: true, color: C.grey }),
          ],
          spacing: { before: 60, after: 60 },
        }));
      });
    }

    // ── Action Items ──
    const acts = actByTopic[topic.topic_id] || [];
    if (acts.length > 0) {
      elems.push(h3(L.actionItems));
      acts.forEach(a => {
        const assignee = a.assignee_name || dn(a.assignee_id, parts);
        const meta = [
          assignee   ? `→ ${assignee}`     : null,
          a.due_date ? `Due: ${a.due_date}` : null,
          a.priority ? cap(a.priority)      : null,
        ].filter(Boolean).join('  ·  ');
        elems.push(new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [
            new TextRun({ text: a.text, font: 'Calibri', size: 21, color: C.darkText }),
            ...(meta ? [new TextRun({ text: `  ${meta}`, font: 'Calibri', size: 18, italic: true, color: priColor(a.priority) })] : []),
          ],
          spacing: { before: 60, after: 60 },
        }));
      });
    }

    elems.push(spacer(1));
  });

  return elems;
}

function buildDecisionsSection(summary, L) {
  const { decisions = [], metadata = {}, docx_config = {} } = summary;
  const fmt_cfg = docx_config.formatting || {};
  const parts   = metadata.participants  || [];
  const incTs   = fmt_cfg.include_timestamps !== false;

  const elems = [sectionBanner(L.decisions), spacer(1)];

  if (!decisions.length) {
    elems.push(callout([p(L.noDecisions, { italic: true, color: C.grey })], { bg: C.rowAlt, accent: C.midGrey }));
    return elems;
  }

  // Columns: # | Decision | Decided By | Agreed By | Time  — sum = 9360
  const cw = [340, 4500, 1760, 1760, 1000];
  elems.push(new Table({
    width: { size: PAGE.content, type: WidthType.DXA },
    columnWidths: cw,
    rows: [
      new TableRow({ tableHeader: true, children: [
        hCell('#', cw[0]), hCell('Decision', cw[1]),
        hCell('Decided By', cw[2]), hCell('Agreed By', cw[3]), hCell('Time', cw[4]),
      ]}),
      ...decisions.map((d, i) => {
        const by     = d.decided_by_name || dn(d.decided_by_id, parts) || '—';
        const agreed = (d.agreed_by_names || []).map((n, j) => n || dn((d.agreed_by_ids || [])[j], parts)).filter(Boolean).join(', ') || '—';
        const bg     = i % 2 === 0 ? C.rowWhite : C.rowAlt;
        return new TableRow({ children: [
          dCell(i + 1, cw[0], { bg, bold: true, color: C.indigo }),
          dCell(d.text, cw[1], { bg }),
          dCell(by,     cw[2], { bg, italic: true, color: C.midText }),
          dCell(agreed, cw[3], { bg, italic: true, color: C.midText }),
          dCell(d.timestamp ? fmt(d.timestamp) : '—', cw[4], { bg, color: C.grey }),
        ]});
      }),
    ],
  }));

  return elems;
}

function buildActionItemsSection(summary, L) {
  const { action_items = [], metadata = {}, docx_config = {} } = summary;
  const parts   = metadata.participants || [];

  const elems = [sectionBanner(L.actionItems), spacer(1)];

  if (!action_items.length) {
    elems.push(callout([p(L.noActions, { italic: true, color: C.grey })], { bg: C.rowAlt, accent: C.midGrey }));
    return elems;
  }

  // High priority count callout
  const highCount = action_items.filter(a => a.priority === 'high').length;
  if (highCount > 0) {
    elems.push(callout([
      p(`${highCount} high-priority item${highCount !== 1 ? 's' : ''} require immediate attention.`, { bold: true, size: 20, color: C.red }),
    ], { bg: C.redBg, accent: C.red }), spacer(1));
  }

  // Columns: # | Action | Assignee | Priority | Due Date   — sum = 9360
  const cw = [340, 4600, 1700, 1420, 1300];
  elems.push(new Table({
    width: { size: PAGE.content, type: WidthType.DXA },
    columnWidths: cw,
    rows: [
      new TableRow({ tableHeader: true, children: [
        hCell('#', cw[0]), hCell('Action Item', cw[1]),
        hCell('Assignee', cw[2]), hCell('Priority', cw[3]), hCell('Due Date', cw[4]),
      ]}),
      ...action_items.map((a, i) => {
        const assignee = a.assignee_name || dn(a.assignee_id, parts) || '—';
        const bg = i % 2 === 0 ? C.rowWhite : C.rowAlt;
        return new TableRow({ children: [
          dCell(i + 1,   cw[0], { bg, bold: true, color: C.indigo }),
          dCell(a.text,  cw[1], { bg }),
          dCell(assignee, cw[2], { bg, italic: true, color: C.midText }),
          priCell(a.priority, cw[3], bg),
          dCell(a.due_date || '—', cw[4], { bg, color: C.grey }),
        ]});
      }),
    ],
  }));

  const total = action_items.length;
  elems.push(p(`${total} action item${total !== 1 ? 's' : ''} total  ·  ${highCount} high priority`, {
    size: 18, italic: true, color: C.grey, before: 80,
  }));

  return elems;
}

function buildSpeakerSection(summary, L) {
  const { speaker_contributions = [], metadata = {} } = summary;
  if (!speaker_contributions.length) return [];

  const parts = metadata.participants || [];
  const elems = [sectionBanner(L.speakers), spacer(1)];

  // Columns: Participant | Time | % | Key Contributions  — sum = 9360
  const cw = [1980, 900, 700, 5780];

  elems.push(new Table({
    width: { size: PAGE.content, type: WidthType.DXA },
    columnWidths: cw,
    rows: [
      new TableRow({ tableHeader: true, children: [
        hCell('Participant', cw[0]),
        hCell('Time', cw[1]),
        hCell('%', cw[2]),
        hCell('Key Contributions', cw[3]),
      ]}),
      ...speaker_contributions.map((sc, idx) => {
        const name    = sc.display_name || sc.name || dn(sc.speaker_id, parts);
        const role    = cap(sc.role || '');
        const timeFmt = sc.speaking_time_seconds != null ? fmt(sc.speaking_time_seconds) : '—';
        const pctStr  = sc.speaking_percentage != null ? `${sc.speaking_percentage.toFixed(0)}%` : '—';
        const bg      = idx % 2 === 0 ? C.rowWhite : C.rowAlt;

        return new TableRow({
          children: [
            // Name + Role
            new TableCell({
              borders: ALL_BORDERS(C.border),
              width: { size: cw[0], type: WidthType.DXA },
              shading: { fill: bg, type: ShadingType.CLEAR },
              margins: CELL_MARGINS,
              children: [
                new Paragraph({ children: [new TextRun({ text: name, font: 'Calibri', size: 21, bold: true, color: C.navy })], spacing: { after: 30 } }),
                ...(role ? [new Paragraph({ children: [new TextRun({ text: role, font: 'Calibri', size: 17, italic: true, color: C.teal })] })] : []),
              ],
            }),
            // Time
            dCell(timeFmt, cw[1], { bg, bold: true, color: C.indigo }),
            // Pct
            dCell(pctStr,  cw[2], { bg, color: C.grey }),
            // Contributions
            new TableCell({
              borders: ALL_BORDERS(C.border),
              width: { size: cw[3], type: WidthType.DXA },
              shading: { fill: bg, type: ShadingType.CLEAR },
              margins: CELL_MARGINS,
              children: (sc.key_contributions || []).length > 0
                ? (sc.key_contributions || []).map(kc =>
                    new Paragraph({
                      children: [
                        new TextRun({ text: '▸  ', font: 'Calibri', size: 19, bold: true, color: C.teal }),
                        new TextRun({ text: kc, font: 'Calibri', size: 20, color: C.darkText }),
                      ],
                      spacing: { before: 40, after: 40 },
                    })
                  )
                : [new Paragraph({ children: [new TextRun({ text: '—', font: 'Calibri', size: 20, color: C.grey })] })],
            }),
          ],
        });
      }),
    ],
  }));

  return elems;
}

function buildSlidesAppendix(summary, L) {
  const { has_slides, slides = [], topics = [], docx_config = {} } = summary;
  if (!has_slides || !slides.length) return [];
  if ((docx_config.formatting || {}).slides_placement !== 'appendix') return [];

  const incTs = (docx_config.formatting || {}).include_timestamps !== false;
  const elems = [sectionBanner(L.slides), spacer(1)];

  const byTopic = {};
  slides.forEach(s => (byTopic[s.topic_id] ||= []).push(s));

  Object.entries(byTopic).forEach(([topicId, topicSlides]) => {
    const topic = topics.find(t => t.topic_id === topicId);
    if (topic) elems.push(h2(topic.title, topic.start_time, topic.end_time));
    topicSlides.forEach(slide => elems.push(...slideBlock(slide, incTs)));
  });

  return elems;
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function generateDocx(summary) {
  const m    = summary.metadata    || {};
  const cfg  = summary.docx_config || {};
  const inc  = cfg.sections_to_include || {};
  const tone = m.tone || 'semi-formal';
  const type = m.meeting_type || 'meeting';
  const L    = labels(tone, type);

  const headerTitle = m.title || 'Meeting Summary';
  const headerDate  = m.date
    ? new Date(m.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  const children = [
    ...(inc.cover_page            !== false ? buildCoverPage(summary, L)          : []),
    ...(inc.executive_summary     !== false ? buildOverview(summary, L)           : []),
    ...(inc.topics_breakdown      !== false ? buildTopics(summary, L)             : []),
    ...(inc.decisions             !== false ? buildDecisionsSection(summary, L)   : []),
    ...(inc.action_items          !== false ? buildActionItemsSection(summary, L) : []),
    ...(inc.speaker_contributions !== false ? buildSpeakerSection(summary, L)     : []),
    ...(inc.slides                !== false ? buildSlidesAppendix(summary, L)     : []),
  ];

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 22, color: C.darkText } },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { size: 36, bold: true, font: 'Calibri', color: C.navy },
          paragraph: { spacing: { before: 480, after: 240 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { size: 26, bold: true, font: 'Calibri', color: C.navy },
          paragraph: { spacing: { before: 320, after: 80 },  outlineLevel: 1 },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { size: 22, bold: true, font: 'Calibri', color: C.indigo },
          paragraph: { spacing: { before: 200, after: 60 },  outlineLevel: 2 },
        },
      ],
    },

    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '▸', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 680, hanging: 340 } } } }],
        },
        {
          reference: 'numbers',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 680, hanging: 340 } } } }],
        },
      ],
    },

    sections: [{
      properties: {
        page: {
          size:   { width: PAGE.w, height: PAGE.h },
          margin: { top: PAGE.margin, right: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin },
        },
      },

      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: headerTitle, font: 'Calibri', size: 17, color: C.grey }),
              new TextRun({ text: `\t${headerDate}`, font: 'Calibri', size: 17, color: C.grey }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.divider, space: 1 } },
          })],
        }),
      },

      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: 'Generated by Botzilla  ·  AI Meeting Intelligence', font: 'Calibri', size: 15, color: C.pageNum }),
              new TextRun({ text: '\tPage ', font: 'Calibri', size: 15, color: C.pageNum }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 15, color: C.pageNum }),
              new TextRun({ text: ' of ', font: 'Calibri', size: 15, color: C.pageNum }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', size: 15, color: C.pageNum }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.divider, space: 1 } },
          })],
        }),
      },

      children,
    }],
  });

  return Packer.toBuffer(doc);
}

// ─────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  if (!args[0]) {
    console.error('Usage: node generate_docx.js <summary.json> [output.docx]');
    process.exit(1);
  }

  const inputPath = args[0];
  if (!fs.existsSync(inputPath)) {
    console.error(`✗ File not found: ${inputPath}`);
    process.exit(1);
  }

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  } catch (e) {
    console.error(`✗ JSON parse error: ${e.message}`);
    process.exit(1);
  }

  const defaultOut = path.join(
    path.dirname(inputPath),
    `${(summary.metadata?.title || 'meeting').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_summary.docx`,
  );
  const outputPath = args[1] || defaultOut;

  console.log(`Botzilla DOCX Generator`);
  console.log(`   Input : ${inputPath}`);
  console.log(`   Output: ${outputPath}`);
  console.log(`   Title : ${summary.metadata?.title || '(untitled)'}`);

  generateDocx(summary)
    .then(buf => {
      fs.writeFileSync(outputPath, buf);
      const kb = (buf.length / 1024).toFixed(1);
      console.log(`✓ Done — ${kb} KB → ${outputPath}`);
    })
    .catch(err => {
      console.error(`✗ Generation failed: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    });
}

module.exports = { generateDocx };
