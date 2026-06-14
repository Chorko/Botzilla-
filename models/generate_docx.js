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
 *
 * Prerequisites: npm install docx
 * Works with: Botzilla Summary JSON schema v1.0+
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
// CONSTANTS
// ─────────────────────────────────────────────────────────────

const C = {
  navy:      '1E3A5F',   // primary headings / brand
  blue:      '2E75B6',   // accent / sub-headings
  lightBlue: 'DDEDF7',   // table header bg
  teal:      '0D7377',   // casual tone accent
  red:       'C42B1C',   // high priority
  amber:     'C97600',   // medium priority (darkened for contrast on white)
  green:     '107C10',   // low priority / positive
  darkText:  '1F1F1F',   // body text
  grey:      '5C5C5C',   // secondary text / meta
  lightGrey: 'F4F5F7',   // alternating row / box bg
  midGrey:   'CACACA',   // borders
  white:     'FFFFFF',
};

// US Letter, 1-inch margins, content width in DXA (1440 DXA = 1 inch)
const PAGE = { w: 12240, h: 15840, margin: 1440, content: 9360 };

const CELL_BORDER = { style: BorderStyle.SINGLE, size: 1, color: C.midGrey };
const ALL_BORDERS  = { top: CELL_BORDER, bottom: CELL_BORDER, left: CELL_BORDER, right: CELL_BORDER };
const CELL_MARGINS = { top: 80, bottom: 80, left: 120, right: 120 };

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Format seconds → H:MM:SS or M:SS */
function fmt(sec) {
  if (sec == null || isNaN(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${z(m)}:${z(s)}` : `${m}:${z(s)}`;
}
function z(n) { return String(n).padStart(2, '0'); }

/** Resolve display name from speaker_id + participants list. Never returns null. */
function dn(speakerId, participants = []) {
  if (!speakerId) return '';
  const p = participants.find(x => x.speaker_id === speakerId);
  if (!p) return speakerId;
  if (p.display_name) return p.display_name;
  if (p.name)         return p.name;
  return `Speaker ${parseInt((speakerId.match(/\d+$/) || ['0'])[0], 10) + 1}`;
}

/** Priority → color */
function priColor(p) {
  return { high: C.red, medium: C.amber, low: C.green }[p] || C.grey;
}

/** "snake_case" → "Snake Case" */
function cap(str) {
  if (!str) return '';
  return str.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Try reading an image file; returns Buffer or null */
function readImg(imgPath) {
  try {
    if (!imgPath) return null;
    // Support absolute paths and relative-to-CWD paths
    const resolved = path.isAbsolute(imgPath) ? imgPath : path.resolve(process.cwd(), imgPath);
    if (!fs.existsSync(resolved)) return null;
    return fs.readFileSync(resolved);
  } catch { return null; }
}

/**
 * Infer image type from extension. Defaults to 'png'.
 * docx ImageRun requires the type to be lowercase: png | jpg | jpeg | gif | bmp
 */
function imgType(imgPath) {
  const ext = (imgPath || '').split('.').pop().toLowerCase();
  return ['png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(ext) ? ext : 'png';
}

/** Tone-adaptive UI labels — professional, semi-formal, casual */
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
    slides:       casual ? 'Screenshots'           : 'Slides & Screen Shares',
    noDecisions:  casual ? 'Nothing to decide.'    : 'No decisions were recorded.',
    noActions:    casual ? 'No follow-ups needed.' : 'No action items were assigned.',
    noKeyPoints:  casual ? 'Nothing notable.'      : 'No key points extracted.',
  };
}

// ─────────────────────────────────────────────────────────────
// PARAGRAPH / TABLE FACTORIES
// ─────────────────────────────────────────────────────────────

/** Plain paragraph with optional overrides */
function p(text, {
  bold = false, italic = false, size = 22,
  color = C.darkText, align = AlignmentType.LEFT,
  before = 0, after = 120,
  bullet = false, numbered = false,
  pageBreak = false,
} = {}) {
  return new Paragraph({
    children: [new TextRun({ text: String(text ?? ''), bold, italic, size, color, font: 'Arial' })],
    alignment: align,
    spacing: { before, after },
    ...(bullet   && { numbering: { reference: 'bullets', level: 0 } }),
    ...(numbered && { numbering: { reference: 'numbers', level: 0 } }),
    ...(pageBreak && { pageBreakBefore: true }),
  });
}

/** Empty spacer paragraph */
function spacer(lines = 1) {
  return new Paragraph({ children: [new TextRun('')], spacing: { after: 120 * lines } });
}

/** H1 with bottom blue border */
function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, font: 'Arial', size: 36, bold: true, color: C.navy })],
    spacing: { before: 480, after: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.blue, space: 1 } },
  });
}

/** H2 with optional timestamp suffix */
function h2(text, startTime, endTime) {
  const tsText = startTime != null ? `  (${fmt(startTime)} – ${fmt(endTime)})` : '';
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [
      new TextRun({ text, font: 'Arial', size: 28, bold: true, color: C.navy }),
      ...(tsText ? [new TextRun({ text: tsText, font: 'Arial', size: 19, italic: true, color: C.grey })] : []),
    ],
    spacing: { before: 360, after: 100 },
  });
}

/** H3 */
function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, font: 'Arial', size: 24, bold: true, color: C.blue })],
    spacing: { before: 220, after: 80 },
  });
}

/**
 * Callout box — single-cell table with left accent border.
 * Use for highlights, OCR captions, notes.
 */
function callout(children, { bgColor = C.lightGrey, accentColor = C.blue } = {}) {
  return new Table({
    width: { size: PAGE.content, type: WidthType.DXA },
    columnWidths: [PAGE.content],
    rows: [new TableRow({
      children: [new TableCell({
        borders: {
          top:    { style: BorderStyle.SINGLE, size: 2,  color: C.midGrey },
          bottom: { style: BorderStyle.SINGLE, size: 2,  color: C.midGrey },
          left:   { style: BorderStyle.SINGLE, size: 12, color: accentColor },
          right:  { style: BorderStyle.NONE, size: 0, color: C.white },
        },
        shading: { fill: bgColor, type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 200, right: 160 },
        children,
      })],
    })],
  });
}

/** Table header cell */
function hCell(text, width) {
  return new TableCell({
    borders: ALL_BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: C.lightBlue, type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    children: [new Paragraph({
      children: [new TextRun({ text, font: 'Arial', size: 20, bold: true, color: C.navy })],
    })],
  });
}

/** Table data cell */
function dCell(text, width, { bg = C.white, color = C.darkText, bold = false, size = 20 } = {}) {
  return new TableCell({
    borders: ALL_BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: bg, type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: [new TextRun({ text: String(text ?? '—'), font: 'Arial', size, bold, color })],
    })],
  });
}

/** Priority cell with colored text */
function priCell(priority, width, rowBg) {
  return new TableCell({
    borders: ALL_BORDERS,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: rowBg, type: ShadingType.CLEAR },
    margins: CELL_MARGINS,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: [new TextRun({ text: cap(priority) || '—', font: 'Arial', size: 20, bold: true, color: priColor(priority) })],
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
        transformation: { width: 540, height: 304 },
        altText: {
          title: `Screen capture at ${fmt(slide.timestamp)}`,
          description: slide.ocr_text || '',
          name: slide.slide_id,
        },
      })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }));
  } else {
    // Placeholder when image file isn't available at generation time
    elems.push(callout([
      p(`📷 Slide image not found: ${slide.image_path || slide.slide_id}`, { italic: true, color: C.grey, size: 18 }),
    ], { bgColor: C.lightGrey, accentColor: C.midGrey }));
  }

  if (incTimestamps && slide.timestamp != null) {
    elems.push(p(`Captured at ${fmt(slide.timestamp)}`, { italic: true, color: C.grey, size: 18, align: AlignmentType.CENTER, after: 80 }));
  }

  if (slide.ocr_text) {
    elems.push(
      callout([
        p(slide.ocr_text, { italic: true, color: C.grey, size: 18 }),
      ], { bgColor: C.lightGrey, accentColor: C.midGrey }),
      spacer(1),
    );
  }

  return elems;
}

// ─────────────────────────────────────────────────────────────
// SECTION BUILDERS
// ─────────────────────────────────────────────────────────────

function buildCoverPage(summary, L) {
  const m   = summary.metadata   || {};
  const o   = summary.overview   || {};
  const cfg = summary.docx_config || {};

  const title     = cfg.document_title || m.title || 'Meeting Summary';
  const subtitle  = cfg.document_subtitle || '';
  const typeLabel = cap(m.meeting_type || 'meeting');
  const dateStr   = m.date
    ? new Date(m.date + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : null;
  const timeStr   = m.time || null;
  const dur       = m.duration_formatted || '';
  const langNote  = m.is_multilingual ? ' (multilingual)' : '';
  const pCount    = m.participant_count || (m.participants || []).length;
  const pNames    = (m.participants || [])
    .map(px => px.display_name || px.name || dn(px.speaker_id, m.participants || []))
    .join('  ·  ');

  const metaLine  = [dateStr, timeStr, dur ? `${dur}${langNote}` : null, pCount ? `${pCount} participants` : null]
    .filter(Boolean).join('   |   ');

  return [
    spacer(4),

    // Brand
    new Paragraph({
      children: [new TextRun({ text: '⚡ BOTZILLA', font: 'Arial', size: 20, bold: true, color: C.blue })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    }),

    // Meeting type badge
    new Paragraph({
      children: [new TextRun({ text: typeLabel.toUpperCase(), font: 'Arial', size: 18, bold: true, color: C.blue })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }),

    // Title
    new Paragraph({
      children: [new TextRun({ text: title, font: 'Arial', size: 52, bold: true, color: C.navy })],
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 200 },
    }),

    // Divider
    new Paragraph({
      children: [new TextRun('')],
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: C.blue, space: 1 } },
      spacing: { after: 240 },
    }),

    // Meta line
    ...(metaLine ? [new Paragraph({
      children: [new TextRun({ text: metaLine, font: 'Arial', size: 21, color: C.grey })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
    })] : []),

    // Participants
    ...(pNames ? [new Paragraph({
      children: [new TextRun({ text: pNames, font: 'Arial', size: 21, italic: true, color: C.grey })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
    })] : []),

    // Outcome + Sentiment
    ...(o.outcome || o.sentiment ? [new Paragraph({
      children: [
        ...(o.outcome   ? [new TextRun({ text: 'Outcome: ',   font: 'Arial', size: 20, bold: true, color: C.navy }),
                           new TextRun({ text: cap(o.outcome), font: 'Arial', size: 20, color: C.grey })] : []),
        ...(o.sentiment ? [new TextRun({ text: '     Sentiment: ',   font: 'Arial', size: 20, bold: true, color: C.navy }),
                           new TextRun({ text: cap(o.sentiment), font: 'Arial', size: 20, color: C.grey })] : []),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
    })] : []),

    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function buildOverview(summary, L) {
  const o = summary.overview || {};
  if (!o.executive_summary && !(o.highlights && o.highlights.length)) return [];

  const elems = [h1(L.execSummary)];

  if (o.executive_summary) {
    elems.push(new Paragraph({
      children: [new TextRun({ text: o.executive_summary, font: 'Arial', size: 22, color: C.darkText })],
      spacing: { before: 80, after: 200 },
    }));
  }

  if (o.purpose) {
    elems.push(new Paragraph({
      children: [
        new TextRun({ text: 'Purpose:  ', font: 'Arial', size: 21, bold: true, color: C.navy }),
        new TextRun({ text: o.purpose,   font: 'Arial', size: 21, color: C.darkText }),
      ],
      spacing: { after: 200 },
    }));
  }

  if (o.highlights && o.highlights.length > 0) {
    elems.push(
      spacer(1),
      callout([
        new Paragraph({
          children: [new TextRun({ text: L.highlights, font: 'Arial', size: 24, bold: true, color: C.navy })],
          spacing: { after: 100 },
        }),
        ...o.highlights.map(h =>
          new Paragraph({
            children: [
              new TextRun({ text: '✓', font: 'Arial', size: 20, bold: true, color: C.green }),
              new TextRun({ text: `  ${h}`, font: 'Arial', size: 21, color: C.darkText }),
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

  const fmt_cfg     = docx_config.formatting || {};
  const inlineSlides  = fmt_cfg.slides_placement !== 'appendix';
  const incTimestamps = fmt_cfg.include_timestamps !== false;
  const parts         = metadata.participants || [];

  const kpByTopic  = {};
  const decByTopic = {};
  const actByTopic = {};
  key_points.forEach(x  => (kpByTopic[x.topic_id]  ||= []).push(x));
  decisions.forEach(x   => (decByTopic[x.topic_id] ||= []).push(x));
  action_items.forEach(x => (actByTopic[x.topic_id] ||= []).push(x));

  const slideMap = {};
  slides.forEach(s => (slideMap[s.slide_id] = s));

  const elems = [h1(L.topics)];

  topics.forEach((topic, idx) => {
    // ── Topic heading ──
    elems.push(h2(`${idx + 1}. ${topic.title}`, topic.start_time, topic.end_time));

    if (topic.topic_type) {
      elems.push(p(cap(topic.topic_type), { size: 18, color: C.blue, bold: true, after: 100 }));
    }

    if (topic.summary) {
      elems.push(new Paragraph({
        children: [new TextRun({ text: topic.summary, font: 'Arial', size: 22, color: C.darkText })],
        spacing: { after: 160 },
      }));
    }

    // ── Inline slides ──
    if (inlineSlides && has_slides && topic.slide_ids && topic.slide_ids.length > 0) {
      const topicSlides = topic.slide_ids.map(id => slideMap[id]).filter(Boolean);
      if (topicSlides.length > 0) {
        elems.push(h3(L.slides));
        topicSlides.forEach(slide => elems.push(...slideBlock(slide, incTimestamps)));
      }
    }

    // ── Key Points ──
    const kps = kpByTopic[topic.topic_id] || [];
    if (kps.length > 0) {
      elems.push(h3(L.keyPoints));
      kps.forEach(kp => {
        const speaker  = kp.speaker_name || dn(kp.speaker_id, parts);
        const tsLabel  = incTimestamps && kp.timestamp ? ` (${fmt(kp.timestamp)})` : '';
        const impColor = kp.importance === 'high' ? C.navy : C.darkText;
        elems.push(new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [
            new TextRun({ text: kp.text, font: 'Arial', size: 21, bold: kp.importance === 'high', color: impColor }),
            ...(speaker || tsLabel ? [new TextRun({ text: `  — ${[speaker, tsLabel].filter(Boolean).join('')}`, font: 'Arial', size: 19, italic: true, color: C.grey })] : []),
          ],
          spacing: { before: 60, after: 60 },
        }));
      });
    }

    // ── Decisions (per-topic) ──
    const decs = decByTopic[topic.topic_id] || [];
    if (decs.length > 0) {
      elems.push(h3(L.decisions));
      decs.forEach(d => {
        const by = d.decided_by_name || dn(d.decided_by_id, parts);
        const agreed = (d.agreed_by_names || [])
          .map((n, i) => n || dn((d.agreed_by_ids || [])[i], parts))
          .filter(Boolean).join(', ');
        const ts = incTimestamps && d.timestamp ? ` (${fmt(d.timestamp)})` : '';
        elems.push(new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [
            new TextRun({ text: d.text, font: 'Arial', size: 21, bold: true }),
            new TextRun({ text: `  ${by ? `Decided by ${by}` : ''}${agreed ? ` · Agreed by ${agreed}` : ''}${ts}`, font: 'Arial', size: 19, italic: true, color: C.grey }),
          ],
          spacing: { before: 60, after: 60 },
        }));
      });
    }

    // ── Action items (per-topic, brief) ──
    const acts = actByTopic[topic.topic_id] || [];
    if (acts.length > 0) {
      elems.push(h3(L.actionItems));
      acts.forEach(a => {
        const assignee = a.assignee_name || dn(a.assignee_id, parts);
        const meta     = [
          assignee ? `→ ${assignee}` : null,
          a.due_date ? `Due: ${a.due_date}` : null,
          a.priority ? cap(a.priority) : null,
        ].filter(Boolean).join('  ·  ');
        elems.push(new Paragraph({
          numbering: { reference: 'bullets', level: 0 },
          children: [
            new TextRun({ text: a.text, font: 'Arial', size: 21 }),
            ...(meta ? [new TextRun({ text: `  ${meta}`, font: 'Arial', size: 19, italic: true, color: priColor(a.priority) })] : []),
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
  const fmt_cfg  = docx_config.formatting || {};
  const parts    = metadata.participants  || [];
  const incTs    = fmt_cfg.include_timestamps !== false;
  const asTable  = fmt_cfg.decisions_as_table === true;

  const elems = [h1(L.decisions)];

  if (!decisions.length) {
    elems.push(p(L.noDecisions, { italic: true, color: C.grey }));
    return elems;
  }

  if (asTable) {
    // ── Decisions table ──
    // Columns: # | Decision | Decided By | Agreed By | Time   — sum = 9360
    const cw = [380, 4300, 1700, 1980, 1000];
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
          const bg     = i % 2 === 0 ? C.white : C.lightGrey;
          return new TableRow({ children: [
            dCell(i + 1, cw[0], { bg }),
            dCell(d.text, cw[1], { bg }),
            dCell(by, cw[2], { bg }),
            dCell(agreed, cw[3], { bg }),
            dCell(d.timestamp ? fmt(d.timestamp) : '—', cw[4], { bg }),
          ]});
        }),
      ],
    }));
  } else {
    // ── Decisions numbered list ──
    decisions.forEach((d, i) => {
      const by     = d.decided_by_name || dn(d.decided_by_id, parts);
      const agreed = (d.agreed_by_names || []).map((n, j) => n || dn((d.agreed_by_ids || [])[j], parts)).filter(Boolean).join(', ');
      const ts     = incTs && d.timestamp ? ` (${fmt(d.timestamp)})` : '';
      elems.push(new Paragraph({
        numbering: { reference: 'numbers', level: 0 },
        children: [
          new TextRun({ text: d.text, font: 'Arial', size: 22, bold: true }),
          new TextRun({ text: `  ${[by && `Decided by ${by}`, agreed && `Agreed by ${agreed}`, ts].filter(Boolean).join(' · ')}`, font: 'Arial', size: 19, italic: true, color: C.grey }),
        ],
        spacing: { before: 100, after: 100 },
      }));
    });
  }

  return elems;
}

function buildActionItemsSection(summary, L) {
  const { action_items = [], metadata = {}, docx_config = {} } = summary;
  const fmt_cfg = docx_config.formatting || {};
  const parts   = metadata.participants  || [];
  const asTable = fmt_cfg.action_items_as_table !== false; // default true

  const elems = [h1(L.actionItems)];

  if (!action_items.length) {
    elems.push(p(L.noActions, { italic: true, color: C.grey }));
    return elems;
  }

  if (asTable) {
    // ── Action items table ──
    // Columns: # | Action | Assignee | Priority | Due Date   — sum = 9360
    const cw = [380, 4700, 1700, 1180, 1400];
    elems.push(new Table({
      width: { size: PAGE.content, type: WidthType.DXA },
      columnWidths: cw,
      rows: [
        new TableRow({ tableHeader: true, children: [
          hCell('#', cw[0]), hCell('Action', cw[1]),
          hCell('Assignee', cw[2]), hCell('Priority', cw[3]), hCell('Due Date', cw[4]),
        ]}),
        ...action_items.map((a, i) => {
          const assignee = a.assignee_name || dn(a.assignee_id, parts) || '—';
          const bg = i % 2 === 0 ? C.white : C.lightGrey;
          return new TableRow({ children: [
            dCell(i + 1,   cw[0], { bg }),
            dCell(a.text,  cw[1], { bg }),
            dCell(assignee, cw[2], { bg }),
            priCell(a.priority, cw[3], bg),
            dCell(a.due_date || '—', cw[4], { bg }),
          ]});
        }),
      ],
    }));

    // Add summary count line below table
    const highCount = action_items.filter(a => a.priority === 'high').length;
    if (highCount > 0) {
      elems.push(p(
        `${action_items.length} action item${action_items.length !== 1 ? 's' : ''} total  ·  ${highCount} high priority`,
        { size: 19, italic: true, color: C.grey, before: 100, after: 80 },
      ));
    }
  } else {
    // ── Bullet list ──
    action_items.forEach(a => {
      const assignee = a.assignee_name || dn(a.assignee_id, parts);
      const meta = [
        assignee   ? `→ ${assignee}`     : null,
        a.due_date ? `Due: ${a.due_date}` : null,
        a.priority ? cap(a.priority)      : null,
      ].filter(Boolean).join('  ·  ');
      elems.push(new Paragraph({
        numbering: { reference: 'bullets', level: 0 },
        children: [
          new TextRun({ text: a.text, font: 'Arial', size: 22 }),
          ...(meta ? [new TextRun({ text: `  ${meta}`, font: 'Arial', size: 19, italic: true, color: priColor(a.priority) })] : []),
        ],
        spacing: { before: 80, after: 80 },
      }));
    });
  }

  return elems;
}

function buildSpeakerSection(summary, L) {
  const { speaker_contributions = [], metadata = {} } = summary;
  if (!speaker_contributions.length) return [];

  const parts = metadata.participants || [];
  const elems = [h1(L.speakers)];

  // Columns: Participant | Speaking Time | Key Contributions   — sum = 9360
  const cw = [2000, 1360, 6000];

  elems.push(new Table({
    width: { size: PAGE.content, type: WidthType.DXA },
    columnWidths: cw,
    rows: [
      new TableRow({ tableHeader: true, children: [
        hCell('Participant', cw[0]),
        hCell('Speaking Time', cw[1]),
        hCell('Key Contributions', cw[2]),
      ]}),
      ...speaker_contributions.map((sc, idx) => {
        const name    = sc.display_name || sc.name || dn(sc.speaker_id, parts);
        const role    = cap(sc.role || '');
        const timeFmt = sc.speaking_time_seconds != null ? fmt(sc.speaking_time_seconds) : '—';
        const pctStr  = sc.speaking_percentage != null ? `${sc.speaking_percentage.toFixed(1)}%` : null;
        const bg      = idx % 2 === 0 ? C.white : C.lightGrey;

        return new TableRow({
          children: [
            // Name + Role
            new TableCell({
              borders: ALL_BORDERS,
              width: { size: cw[0], type: WidthType.DXA },
              shading: { fill: bg, type: ShadingType.CLEAR },
              margins: CELL_MARGINS,
              children: [
                new Paragraph({ children: [new TextRun({ text: name, font: 'Arial', size: 21, bold: true, color: C.navy })], spacing: { after: 40 } }),
                ...(role ? [new Paragraph({ children: [new TextRun({ text: role, font: 'Arial', size: 18, italic: true, color: C.blue })] })] : []),
              ],
            }),
            // Speaking time
            new TableCell({
              borders: ALL_BORDERS,
              width: { size: cw[1], type: WidthType.DXA },
              shading: { fill: bg, type: ShadingType.CLEAR },
              margins: CELL_MARGINS,
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({ children: [new TextRun({ text: timeFmt, font: 'Arial', size: 21, bold: true, color: C.navy })], spacing: { after: 30 } }),
                ...(pctStr ? [new Paragraph({ children: [new TextRun({ text: pctStr, font: 'Arial', size: 18, color: C.grey })] })] : []),
              ],
            }),
            // Contributions
            new TableCell({
              borders: ALL_BORDERS,
              width: { size: cw[2], type: WidthType.DXA },
              shading: { fill: bg, type: ShadingType.CLEAR },
              margins: CELL_MARGINS,
              children: (sc.key_contributions || []).length > 0
                ? (sc.key_contributions || []).map(kc =>
                    new Paragraph({
                      children: [
                        new TextRun({ text: '•  ', font: 'Arial', size: 19, bold: true, color: C.blue }),
                        new TextRun({ text: kc, font: 'Arial', size: 20, color: C.darkText }),
                      ],
                      spacing: { before: 40, after: 40 },
                    })
                  )
                : [new Paragraph({ children: [new TextRun({ text: '—', font: 'Arial', size: 20, color: C.grey })] })],
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

  const incTimestamps = (docx_config.formatting || {}).include_timestamps !== false;
  const elems         = [h1(L.slides)];

  // Group by topic
  const byTopic = {};
  slides.forEach(s => (byTopic[s.topic_id] ||= []).push(s));

  Object.entries(byTopic).forEach(([topicId, topicSlides]) => {
    const topic = topics.find(t => t.topic_id === topicId);
    if (topic) elems.push(h2(topic.title, topic.start_time, topic.end_time));
    topicSlides.forEach(slide => elems.push(...slideBlock(slide, incTimestamps)));
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

  const headerTitle = cfg.document_title || m.title || 'Meeting Summary';
  const headerDate  = m.date
    ? new Date(m.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  // Build all content sections
  const children = [
    ...(inc.cover_page              !== false ? buildCoverPage(summary, L)          : []),
    ...(inc.executive_summary       !== false ? buildOverview(summary, L)           : []),
    ...(inc.topics_breakdown        !== false ? buildTopics(summary, L)             : []),
    ...(inc.decisions               !== false ? buildDecisionsSection(summary, L)   : []),
    ...(inc.action_items            !== false ? buildActionItemsSection(summary, L) : []),
    ...(inc.speaker_contributions   !== false ? buildSpeakerSection(summary, L)     : []),
    ...(inc.slides                  !== false ? buildSlidesAppendix(summary, L)     : []),
  ];

  const doc = new Document({
    // ── Style overrides ──
    styles: {
      default: {
        document: { run: { font: 'Arial', size: 24, color: C.darkText } },
      },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { size: 36, bold: true, font: 'Arial', color: C.navy },
          paragraph: { spacing: { before: 480, after: 240 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { size: 28, bold: true, font: 'Arial', color: C.navy },
          paragraph: { spacing: { before: 360, after: 100 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run:       { size: 24, bold: true, font: 'Arial', color: C.blue },
          paragraph: { spacing: { before: 220, after: 80 }, outlineLevel: 2 },
        },
      ],
    },

    // ── Numbering ──
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
        },
        {
          reference: 'numbers',
          levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
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

      // ── Header ──
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [
              new TextRun({ text: headerTitle, font: 'Arial', size: 18, color: C.grey }),
              new TextRun({ text: `\t${headerDate}`, font: 'Arial', size: 18, color: C.grey }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: C.midGrey, space: 1 } },
          })],
        }),
      },

      // ── Footer ──
      footers: {
        default: new Footer({
          children: [new Paragraph({
            children: [
              new TextRun({ text: '⚡ Generated by Botzilla', font: 'Arial', size: 16, color: C.grey }),
              new TextRun({ text: '\tPage ', font: 'Arial', size: 16, color: C.grey }),
              new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 16, color: C.grey }),
              new TextRun({ text: ' of ', font: 'Arial', size: 16, color: C.grey }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 16, color: C.grey }),
            ],
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            border: { top: { style: BorderStyle.SINGLE, size: 2, color: C.midGrey, space: 1 } },
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

  console.log(`⚡ Botzilla DOCX Generator`);
  console.log(`   Input : ${inputPath}`);
  console.log(`   Output: ${outputPath}`);
  console.log(`   Title : ${summary.metadata?.title || '(untitled)'}`);

  generateDocx(summary)
    .then(buf => {
      fs.writeFileSync(outputPath, buf);
      const kb = (buf.length / 1024).toFixed(1);
      console.log(`✓ Done — ${kb} KB written to ${outputPath}`);
    })
    .catch(err => {
      console.error(`✗ Generation failed: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    });
}

module.exports = { generateDocx };
