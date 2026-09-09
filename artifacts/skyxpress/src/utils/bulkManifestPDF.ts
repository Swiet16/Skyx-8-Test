// @ts-nocheck
// Bulk Manifest PDF — premium redesign with SkyXpress branding
import { jsPDF } from "jspdf";
import logoUrl from "@/assets/skyxpress_logo.png";
import type { ManifestStockEntry } from "./manifestStorage";

// ── Brand palette ─────────────────────────────────────────────────────────────
type RGB = [number, number, number];
const NAVY:    RGB = [15, 35, 85];
const NAVY2:   RGB = [22, 52, 120];
const ORANGE:  RGB = [226, 84, 20];
const WHITE:   RGB = [255, 255, 255];
const OFFWHITE:RGB = [248, 249, 252];
const LGRAY:   RGB = [237, 240, 248];
const MGRAY:   RGB = [160, 170, 195];
const DARK:    RGB = [18, 22, 45];
const ALT:     RGB = [242, 245, 255];

// Status colour map — AWB-level statuses
const ST_COLORS: Record<string, { bg: RGB; text: RGB }> = {
  "DELIVERED":        { bg: [16, 150, 72],   text: WHITE },
  "IN TRANSIT":       { bg: [37, 99, 235],   text: WHITE },
  "PICKED UP":        { bg: [99, 102, 241],  text: WHITE },
  "PROCESSING":       { bg: [202, 138, 4],   text: WHITE },
  "CREATED":          { bg: [202, 138, 4],   text: WHITE },
  "OUT FOR DELIVERY": { bg: [99, 102, 241],  text: WHITE },
  "CUSTOMS":          { bg: [234, 88, 12],   text: WHITE },
  "CANCELLED":        { bg: [220, 38, 38],   text: WHITE },
  "CUSTOM HOLD":      { bg: [220, 38, 38],   text: WHITE },
};

// Manifest-level status styles for PDF
// No emoji — jsPDF cannot render Unicode emoji; use plain ASCII labels only.
const MANIFEST_STATUS_STYLES: Record<string, { bg: RGB; text: RGB; label: string; tag: string }> = {
  live:             { bg: [16, 185, 129],  text: WHITE, label: "LIVE",             tag: "LIVE"  },
  pending:          { bg: [245, 158, 11],  text: WHITE, label: "PENDING",          tag: "PEND"  },
  picked_up:        { bg: [139, 92, 246],  text: WHITE, label: "PICKED UP",        tag: "PKU"   },
  in_transit:       { bg: [37, 99, 235],   text: WHITE, label: "IN TRANSIT",       tag: "AIR"   },
  out_for_delivery: { bg: [249, 115, 22],  text: WHITE, label: "OUT FOR DELIVERY", tag: "OFD"   },
  delivered:        { bg: [22, 163, 74],   text: WHITE, label: "DELIVERED",        tag: "DONE"  },
  returned:         { bg: [239, 68, 68],   text: WHITE, label: "RETURNED",         tag: "RTN"   },
};

function cc(pdf: jsPDF, r: RGB) { pdf.setFillColor(r[0], r[1], r[2]); }
function tc(pdf: jsPDF, r: RGB) { pdf.setTextColor(r[0], r[1], r[2]); }
function dc(pdf: jsPDF, r: RGB) { pdf.setDrawColor(r[0], r[1], r[2]); }

function country(code: string, map: Record<string, string>) {
  return map[code] || code || "—";
}

export async function generateBulkManifestPDF(
  entry: ManifestStockEntry,
  countryMap: Record<string, string>
): Promise<void> {
  const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const PW = 297, PH = 210;
  const ML = 10, MR = 10; // margins
  const CW = PW - ML - MR; // content width = 277

  // ═══════════════════════════════════════════════════════════════════════════
  // HEADER  (total height 44mm — logo + manifest ID block on left, title
  //          centred, status pill on right)
  // ═══════════════════════════════════════════════════════════════════════════
  const HDR_H = 44;

  // Flat uniform navy header — no diagonal bands or shade variations
  cc(pdf, NAVY); pdf.rect(0, 0, PW, HDR_H, "F");
  // Orange accent bar at bottom of header
  cc(pdf, ORANGE); pdf.rect(0, HDR_H, PW, 3, "F");

  // ── Logo (top-left) ──────────────────────────────────────────────────────
  try {
    const resp = await fetch(logoUrl);
    const blob = await resp.blob();
    const b64 = await new Promise<string>((res) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.readAsDataURL(blob);
    });
    pdf.addImage(b64, "PNG", ML, 3, 44, 20);
  } catch (_) {}

  // ── Manifest ID block — top-left, directly under the logo ────────────────
  //   Styled like a boarding-pass / courier label:
  //   [ ▌ MANIFEST ID  ]
  //   [ ▌  SX-191234   ]  ← monospaced, large, white on dark
  const midX = ML;
  const midY = 25.5;   // just below logo bottom (3 + 20 = 23, +2.5 gap)
  const midW = 56;     // same width as logo area
  const midH = 15.5;

  // Outer box — very dark navy, rounded
  cc(pdf, [8, 18, 55]); pdf.roundedRect(midX, midY, midW, midH, 2, 2, "F");
  // Orange left-accent stripe (4 mm wide)
  cc(pdf, ORANGE); pdf.roundedRect(midX, midY, 4, midH, 2, 2, "F");
  pdf.rect(midX + 2, midY, 2, midH, "F");  // square right edge of stripe
  // Subtle inner-top highlight line
  cc(pdf, [40, 80, 170]); pdf.rect(midX + 4, midY, midW - 4, 0.8, "F");

  // "MANIFEST ID" micro-label
  tc(pdf, ORANGE);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(5.2);
  pdf.text("MANIFEST  ID", midX + midW / 2 + 2, midY + 5.5, { align: "center" });

  // Manifest ID value — large, white, monospace-style
  tc(pdf, WHITE);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(11);
  pdf.text(entry.manifestId, midX + midW / 2 + 2, midY + 13, { align: "center" });

  // Subtle scan-line dashes at the bottom of the box for a courier-label feel
  dc(pdf, ORANGE); pdf.setLineWidth(0.25);
  for (let xi = midX + 4; xi < midX + midW - 1; xi += 3) {
    pdf.line(xi, midY + midH - 1.5, xi + 1.5, midY + midH - 1.5);
  }

  // ── Center title block ───────────────────────────────────────────────────
  tc(pdf, WHITE);
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(20);
  pdf.text("SHIPMENT MANIFEST", PW / 2, 17, { align: "center" });
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(8);
  tc(pdf, MGRAY);
  pdf.text("SkyXpress International Courier & Cargo  ·  skyxpress.site", PW / 2, 25, { align: "center" });

  // ── Manifest status pill — top-right (compact, label only, no tag zone) ───
  const mStatus = (entry as any).manifestStatus as string | undefined;
  if (mStatus && MANIFEST_STATUS_STYLES[mStatus]) {
    const ms = MANIFEST_STATUS_STYLES[mStatus];
    const spH = 10, spY = 17;
    // Measure label width and size pill to fit snugly
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
    const labelW = pdf.getTextWidth(ms.label);
    const spW = labelW + 14; // 7mm padding each side
    const spX = PW - MR - spW;
    // Single solid pill — status colour, label centred
    cc(pdf, ms.bg);
    pdf.roundedRect(spX, spY, spW, spH, 5, 5, "F");
    tc(pdf, WHITE);
    pdf.text(ms.label, spX + spW / 2, spY + 6.8, { align: "center" });
  }

  let y = HDR_H + 6;

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY STATS — 6 cards in a row
  // ═══════════════════════════════════════════════════════════════════════════
  const dateStr = new Date(entry.createdAt).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
  // Normalise service type: underscores → spaces, comma-separated → newline-friendly
  const svcRaw = entry.serviceType.replace(/_/g, " ");

  const stats = [
    { label: "GENERATED",     value: dateStr },
    { label: "TOTAL PARCELS", value: String(entry.parcelCount) },
    { label: "TOTAL PIECES",  value: String(entry.totalPieces) },
    { label: "TOTAL WEIGHT",  value: `${entry.totalWeight.toFixed(2)} kg` },
    { label: "TOTAL VALUE",   value: `${entry.currency} ${entry.totalValue.toFixed(2)}` },
    { label: "SERVICE TYPE",  value: svcRaw, wrap: true },
  ];

  const cardW = (CW - 5 * 2) / 6; // 6 cards with 2mm gaps
  const cardH = 16; // slightly taller to accommodate 2-line service

  stats.forEach((s: any, i) => {
    const cx = ML + i * (cardW + 2);
    cc(pdf, LGRAY); pdf.roundedRect(cx, y, cardW, cardH, 1.5, 1.5, "F");
    cc(pdf, ORANGE); pdf.rect(cx, y, cardW, 1.5, "F");

    // Label
    tc(pdf, ORANGE);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(5.5);
    pdf.text(s.label, cx + cardW / 2, y + 6, { align: "center" });

    // Value — wrap long service types across 2 lines at smaller font
    tc(pdf, DARK);
    if (s.wrap) {
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(6.5);
      const lines = pdf.splitTextToSize(s.value, cardW - 2) as string[];
      const maxLines = lines.slice(0, 2);
      const lineH = 4;
      const startY = y + 10 + (maxLines.length === 1 ? 2 : 0);
      maxLines.forEach((line, li) => {
        pdf.text(line, cx + cardW / 2, startY + li * lineH, { align: "center" });
      });
    } else {
      pdf.setFont("helvetica", "bold"); pdf.setFontSize(8.5);
      pdf.text(s.value, cx + cardW / 2, y + 12.5, { align: "center" });
    }
  });
  y += cardH + 5;

  // ═══════════════════════════════════════════════════════════════════════════
  // TABLE
  // ═══════════════════════════════════════════════════════════════════════════

  // Column definitions: [label, x-offset from ML, width]
  // FIX: first ID column was labelled "HAWB / REF" and filled with
  // `reference_id || tracking_id`, so it always displayed the reference id.
  // The user wants the TRACKING ID shown here — relabelled and re-ordered.
  const cols: [string, number, number][] = [
    ["#",          0,    6],
    ["TRACKING ID", 7,   25],
    ["SHIPPER",    33,  32],
    ["CONSIGNEE",  66,  32],
    ["FROM",       99,  22],
    ["TO",         122, 22],
    ["PKG",        145, 18],
    ["PCS",        164, 9],
    ["WT (kg)",    174, 16],
    ["VALUE",      191, 22],
    ["SERVICE",    214, 26],
    ["STATUS",     241, 36],
  ];

  const ROW_H = 7;

  // Header row
  cc(pdf, NAVY);
  pdf.rect(ML, y, CW, ROW_H + 1, "F");
  cols.forEach(([lbl, ox]) => {
    tc(pdf, WHITE);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(6);
    pdf.text(lbl, ML + ox + 1, y + 5.5);
  });
  y += ROW_H + 1;

  // Data rows
  const maxRows = Math.min(entry.parcels.length, 20);
  for (let i = 0; i < maxRows; i++) {
    const p = entry.parcels[i];
    const isAlt = i % 2 === 1;

    // Row background
    if (isAlt) { cc(pdf, ALT); pdf.rect(ML, y, CW, ROW_H, "F"); }

    // Row separator
    dc(pdf, [220, 225, 240]); pdf.setLineWidth(0.12);
    pdf.line(ML, y + ROW_H, ML + CW, y + ROW_H);

    tc(pdf, DARK);
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.8);

    const row = (v: string, ox: number, w: number) => {
      const lines = pdf.splitTextToSize(v || "—", w - 1) as string[];
      pdf.text(lines[0], ML + ox + 1, y + 5);
    };

    pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.8);
    row(String(i + 1),                                   0,   5);
    // FIX: show the TRACKING ID first (was `reference_id || tracking_id`, which
    // always printed the reference id in the tracking column).
    row(p.tracking_id || p.reference_id || "",           7,   24);
    row(p.sender_name || "",                              33,  31);
    row(p.receiver_name || "",                            66,  31);
    row(country(p.from_country, countryMap),              99,  21);
    row(country(p.to_country,   countryMap),              122, 21);
    row(p.parcel_type || "",                              145, 17);
    row(String(p.pieces ?? 1),                            164, 8);
    row(Number(p.weight ?? 0).toFixed(2),                 174, 15);
    row(`${p.currency || ""} ${Number(p.total_price ?? 0).toFixed(2)}`, 191, 21);

    // SERVICE — smaller font, truncate long names
    const svc = (p.service_type || "").replace(/_/g, " ");
    const svcShort = svc.length > 13 ? svc.slice(0, 12) + "…" : svc;
    pdf.setFont("helvetica", "normal"); pdf.setFontSize(5.8);
    tc(pdf, DARK);
    pdf.text(svcShort, ML + 214 + 1, y + 5);

    // STATUS badge — compact
    const raw = (p.current_status || "").replace(/_/g, " ").toUpperCase();
    const rawShort = raw.length > 12 ? raw.slice(0, 11) + "…" : raw;
    const stC = ST_COLORS[raw] || { bg: [100, 116, 139] as RGB, text: WHITE };
    cc(pdf, stC.bg as RGB);
    pdf.roundedRect(ML + 241 + 1, y + 1.3, 34, ROW_H - 2.6, 1.5, 1.5, "F");
    tc(pdf, stC.text as RGB);
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(5);
    pdf.text(rawShort, ML + 241 + 18, y + 5.1, { align: "center" });

    y += ROW_H;
  }

  // Overflow note
  if (entry.parcels.length > maxRows) {
    tc(pdf, MGRAY); pdf.setFont("helvetica", "italic"); pdf.setFontSize(6.5);
    pdf.text(
      `… ${entry.parcels.length - maxRows} additional parcels — see Excel export for full list.`,
      ML + 2, y + 5
    );
    y += 7;
  }

  // ── Totals row ─────────────────────────────────────────────────────────────
  cc(pdf, ORANGE); pdf.rect(ML, y, CW, ROW_H + 1.5, "F");
  tc(pdf, WHITE); pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
  pdf.text("TOTALS", ML + 2, y + 6);
  pdf.text(String(entry.totalPieces),                        ML + 165, y + 6);
  pdf.text(`${entry.totalWeight.toFixed(2)} kg`,             ML + 175, y + 6);
  pdf.text(`${entry.currency} ${entry.totalValue.toFixed(2)}`, ML + 192, y + 6);
  y += ROW_H + 6;

  // ═══════════════════════════════════════════════════════════════════════════
  // SIGNATURE STRIP
  // ═══════════════════════════════════════════════════════════════════════════
  const remaining = PH - 14 - y; // space before footer
  const sigH = Math.min(remaining - 2, 20);
  if (sigH > 10) {
    const sigW = (CW - 8) / 3;
    const sigs = [
      { title: "PREPARED BY",        sub: "Authorized Signatory" },
      { title: "VERIFIED BY",        sub: "Supervisor / Manager" },
      { title: "CARRIER'S SIGNATURE", sub: "Agent / Carrier" },
    ];
    sigs.forEach((s, i) => {
      const sx = ML + i * (sigW + 4);
      cc(pdf, OFFWHITE); pdf.roundedRect(sx, y, sigW, sigH, 2, 2, "F");
      dc(pdf, LGRAY); pdf.setLineWidth(0.3);
      pdf.roundedRect(sx, y, sigW, sigH, 2, 2, "S");

      tc(pdf, ORANGE); pdf.setFont("helvetica", "bold"); pdf.setFontSize(6);
      pdf.text(s.title, sx + 3, y + 6);

      dc(pdf, ORANGE); pdf.setLineWidth(0.5);
      pdf.line(sx + 4, y + sigH - 5, sx + sigW - 4, y + sigH - 5);

      tc(pdf, MGRAY); pdf.setFont("helvetica", "normal"); pdf.setFontSize(5.5);
      pdf.text(s.sub, sx + 3, y + sigH - 1.5);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FOOTER
  // ═══════════════════════════════════════════════════════════════════════════
  cc(pdf, NAVY); pdf.rect(0, PH - 10, PW, 10, "F");
  cc(pdf, ORANGE); pdf.rect(0, PH - 11, PW, 1, "F");
  tc(pdf, MGRAY); pdf.setFont("helvetica", "normal"); pdf.setFontSize(6.5);
  pdf.text(
    `SkyXpress International Courier & Cargo  ·  Manifest ID: ${entry.manifestId}  ·  Generated: ${new Date().toLocaleString()}  ·  This document is system-generated and does not require a wet signature.`,
    PW / 2, PH - 4, { align: "center" }
  );

  // Use blob download instead of pdf.save() for cross-environment compatibility
  const blob = pdf.output("blob");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SkyXpress_Manifest_${entry.manifestId}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
