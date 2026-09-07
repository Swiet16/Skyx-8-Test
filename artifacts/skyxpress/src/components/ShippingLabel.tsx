// @ts-nocheck
import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, X, FileDown } from "lucide-react";
import skyxpressLogo from "@/assets/skyxpress_logo.png";

/* â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/**
 * Return "DOX" if parcel is a document, otherwise "NON DOX".
 *
 * FIX: the old version only matched the exact strings "document" / "doc" / "dox".
 * If the value coming from the form/select was anything else â€” "Documents" (plural),
 * "Non-Document", "non_document", "Non Doc", etc. â€” the exact match failed and it
 * silently fell through to "NON DOX" even when "Document" was selected, and vice
 * versa. This version checks for a "non" prefix/substring FIRST (so any
 * "non-document"/"non doc"/"non_dox" variant is always NON DOX), then checks for
 * "doc"/"dox" for the DOX case. This makes it robust to plural/hyphen/underscore/
 * casing differences.
 */
function getDoxLabel(parcelType: string): "DOX" | "NON DOX" {
  const t = (parcelType || "").toLowerCase().trim();
  if (t.includes("non")) return "NON DOX";
  if (t.includes("doc") || t.includes("dox")) return "DOX";
  return "NON DOX";
}

/** Derive a 3-letter origin code from a city name. Falls back to country code. */
function originCode(city: string | undefined, countryCode: string | undefined): string {
  const CITY_MAP: Record<string, string> = {
    lahore: "LHE", karachi: "KHI", islamabad: "ISB", peshawar: "PEW",
    quetta: "UET", multan: "MUX", faisalabad: "LYP", sialkot: "SKT",
    dubai: "DXB", "abu dhabi": "AUH", london: "LHR", "new york": "JFK",
    paris: "CDG", frankfurt: "FRA", amsterdam: "AMS", madrid: "MAD",
    barcelona: "BCN", rome: "FCO", milan: "MXP", istanbul: "IST",
    doha: "DOH", "kuala lumpur": "KUL", singapore: "SIN", bangkok: "BKK",
    beijing: "PEK", shanghai: "PVG", tokyo: "NRT", seoul: "ICN",
    sydney: "SYD", toronto: "YYZ", "los angeles": "LAX", chicago: "ORD",
  };
  const key = (city || "").toLowerCase().trim();
  if (CITY_MAP[key]) return CITY_MAP[key];
  if (city && city.length >= 3) return city.slice(0, 3).toUpperCase();
  if (countryCode) return countryCode.slice(0, 3).toUpperCase();
  return "???";
}

/** Format a date as DD MMM YYYY */
function labelDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    timeZone: "Asia/Karachi",
  }).toUpperCase();
}

/* â”€â”€â”€ Barcode sub-component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
function Barcode({ value, height = 50 }: { value: string; height?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: "CODE128",
        height,
        displayValue: false,
        margin: 0,
        background: "#fff",
        lineColor: "#000",
      });
    } catch {
      // silent fallback â€” barcode renders as empty
    }
  }, [value, height]);
  return <svg ref={svgRef} style={{ width: "100%", display: "block" }} />;
}

/* â”€â”€â”€ Label component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
interface Parcel {
  tracking_id: string;
  reference_id?: string;
  sender_name: string;
  sender_cnic?: string;
  sender_company?: string;
  sender_address?: string;
  sender_address_2?: string;
  sender_address_3?: string;
  sender_city?: string;
  sender_country?: string;
  sender_phone?: string;
  receiver_name: string;
  receiver_company?: string;
  receiver_address?: string;
  receiver_address_2?: string;
  receiver_city?: string;
  receiver_state?: string;
  receiver_postal_code?: string;
  receiver_country?: string;
  receiver_phone?: string;
  parcel_type: string;
  document_type?: string;
  weight: number;
  pieces?: number;
  service_type?: string;
  from_country: string;
  to_country: string;
  created_at?: string;
  items?: Array<{ description: string }>;
}

interface ShippingLabelProps {
  parcel: Parcel | null;
  open: boolean;
  onClose: () => void;
  countryMap?: Record<string, string>;
}

const WEBSITE = "www.skyxpress.site";

export function ShippingLabel({ parcel, open, onClose, countryMap = {} }: ShippingLabelProps) {
  // ── Robust print positioning ──────────────────────────────────────────
  // FIX (overlapping / misaligned print): the static `@media print` CSS
  // fallback below (used whenever the browser's own Print/Ctrl+P is used
  // instead of the in-app "Print" button) rotates + scales + translates the
  // label using a HARD-CODED assumed natural height (750px). Real labels
  // vary in height — longer addresses wrap onto extra lines, phone numbers
  // wrap, contents text wraps, etc. — so the assumed height is very often
  // wrong. Because the translate/scale math is derived FROM that assumed
  // height, any mismatch causes the rotated label to land at the wrong
  // scale/position on the page, which is what makes rows and columns
  // print on top of one another.
  //
  // The fix: measure the label's REAL rendered height right before the
  // browser prints (the `beforeprint` event fires synchronously for both
  // the native browser print UI and window.print()), recompute the exact
  // same transform the in-app "Print" button already computes correctly,
  // and apply it directly as an inline style. Inline styles win over the
  // stylesheet fallback (same !important, higher specificity), so this
  // takes effect no matter how printing was triggered. `afterprint`
  // restores the element so the on-screen preview is unaffected.
  useEffect(() => {
    const LABEL_ID = "shipping-label-print";
    const LABEL_W = 560;
    const PX_PER_MM = 96 / 25.4;
    const USABLE_W_PX = (210 - 20) * PX_PER_MM; // A4 width minus 10mm margins
    const USABLE_H_PX = (297 - 20) * PX_PER_MM; // A4 height minus 10mm margins
    const SIDE_BREATHING_PX = 14;
    const BOTTOM_BREATHING_PX = 14;

    const applyPrintTransform = () => {
      const el = document.getElementById(LABEL_ID);
      if (!el) return;
      // Reset any previous transform first so we measure the label's true
      // un-rotated, un-scaled height, not a stale transformed one.
      el.style.setProperty("transform", "none", "important");
      const naturalHeight = el.getBoundingClientRect().height || el.scrollHeight;
      if (!naturalHeight) return;
      const scale = Math.min(1.15, (USABLE_W_PX - 2 * SIDE_BREATHING_PX) / naturalHeight);
      const scaledW = LABEL_W * scale;
      const scaledH = naturalHeight * scale;
      const rotatedW = scaledH; // page horizontal extent after 90° rotation
      const rotatedH = scaledW; // page vertical extent after 90° rotation
      const offsetX = Math.max(0, (USABLE_W_PX - rotatedW) / 2);
      const offsetY = Math.max(0, USABLE_H_PX - rotatedH - BOTTOM_BREATHING_PX);
      el.style.setProperty("transform-origin", "0 0", "important");
      el.style.setProperty(
        "transform",
        `translate(${offsetX}px, ${offsetY + scaledW}px) rotate(-90deg) scale(${scale})`,
        "important"
      );
      el.style.setProperty("position", "fixed", "important");
      el.style.setProperty("top", "0", "important");
      el.style.setProperty("left", "0", "important");
    };

    const clearPrintTransform = () => {
      const el = document.getElementById(LABEL_ID);
      if (!el) return;
      el.style.removeProperty("transform");
      el.style.removeProperty("transform-origin");
      el.style.removeProperty("position");
      el.style.removeProperty("top");
      el.style.removeProperty("left");
    };

    window.addEventListener("beforeprint", applyPrintTransform);
    window.addEventListener("afterprint", clearPrintTransform);
    return () => {
      window.removeEventListener("beforeprint", applyPrintTransform);
      window.removeEventListener("afterprint", clearPrintTransform);
    };
  }, []);

  if (!parcel) return null;

  // FIX: DOX/NON DOX must come from `document_type` (the Document / Non-Document
  // toggle in the Shipment step), NOT `parcel_type` (which is the physical
  // package type â€” box/envelope/pallet/other, set in the Package step). The
  // old code read parcel.parcel_type here, so selecting "Document" never had
  // any effect on the label â€” it was checking the wrong field entirely.
  const dox = getDoxLabel(parcel.document_type ?? parcel.parcel_type);
  const origin = originCode(parcel.sender_city, parcel.from_country);
  const cnicCode = parcel.sender_cnic || "N/A";
  const trackCode = parcel.tracking_id;
  const serviceType = (parcel.service_type || "EXPRESS WORLDWIDE").toUpperCase();
  const pieces = parcel.pieces ?? 1;
  const weightKg = Number(parcel.weight || 0).toFixed(1);

  // Day + Time from created_at (or now)
  const createdDate = parcel.created_at ? new Date(parcel.created_at) : new Date();
  const dayStr = createdDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Karachi" });
  const timeStr = createdDate.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Karachi" });
  const contentsText = Array.isArray(parcel.items) && parcel.items.length > 0
    ? parcel.items.map((i) => i.description).filter(Boolean).join(", ")
    : parcel.parcel_type || "GENERAL CARGO";

  const getCountry = (code: string) => countryMap[code] || code || "";

  /* â”€â”€â”€ Receiver address lines â”€â”€â”€ */
  const rcvLines = [
    parcel.receiver_company && parcel.receiver_company !== parcel.receiver_name
      ? parcel.receiver_company : null,
    parcel.receiver_address,
    parcel.receiver_address_2,
    [parcel.receiver_postal_code, parcel.receiver_city, parcel.receiver_state]
      .filter(Boolean).join(" ") || null,
    getCountry(parcel.receiver_country || ""),
  ].filter(Boolean) as string[];

  /* â”€â”€â”€ Sender address lines â”€â”€â”€ */
  const sndLines = [
    parcel.sender_company && parcel.sender_company !== parcel.sender_name
      ? parcel.sender_company : null,
    parcel.sender_address,
    parcel.sender_address_2,
    parcel.sender_address_3,
    [parcel.sender_city, getCountry(parcel.sender_country || parcel.from_country || "")]
      .filter(Boolean).join(", ") || null,
  ].filter(Boolean) as string[];

  const handlePrint = () => {
    const labelEl = document.getElementById("shipping-label-print");
    if (!labelEl) return;

    const printWindow = window.open("", "_blank", "width=700,height=900");
    if (!printWindow) return;

    // Build the document safely using DOM APIs â€” no string interpolation of user data
    const doc = printWindow.document;

    // Collect styles from the current document
    const styleContent = Array.from(document.querySelectorAll("style"))
      .map((el) => el.textContent || "")
      .join("\n");

    doc.write("<!DOCTYPE html><html><head></head><body></body></html>");
    doc.close();

    // Set title safely via textContent (no XSS risk)
    doc.title = `Shipping Label â€” ${parcel.tracking_id}`;

    // Charset meta
    const meta = doc.createElement("meta");
    meta.setAttribute("charset", "utf-8");
    doc.head.appendChild(meta);

    // Inline styles from main document
    const styleEl = doc.createElement("style");
    styleEl.textContent = styleContent;
    doc.head.appendChild(styleEl);

    // ── A4 geometry ──
    // A4 = 210 × 297 mm PORTRAIT. With a 10 mm margin each side we get a
    // usable printable area of 190 × 277 mm.
    //
    // The label itself is rendered in its original PORTRAIT design (560 px
    // wide on screen) and then ROTATED 90° COUNTER-CLOCKWISE so it appears
    // in LANDSCAPE orientation on the A4 page. The rest of the page is
    // left blank/white, and the rotated label is anchored to the BOTTOM
    // of the usable area, centered horizontally — exactly as requested.
    //
    // After rotation, the label's effective footprint on the page is:
    //   rotatedW = scaledH    (was the design height, now the page width)
    //   rotatedH = scaledW    (was the design width,  now the page height)
    // We compute the scale dynamically so rotatedW fits inside the usable
    // page width with a comfortable breathing margin on each side.
    const LABEL_W = 560;
    const PX_PER_MM = 96 / 25.4;
    const USABLE_W_PX = (210 - 20) * PX_PER_MM; // ≈ 718 px
    const USABLE_H_PX = (297 - 20) * PX_PER_MM; // ≈ 1046 px
    const SIDE_BREATHING_PX = 14;               // breathing room each side after rotation
    const BOTTOM_BREATHING_PX = 14;             // breathing room below the rotated label

    const naturalHeight = labelEl.getBoundingClientRect().height || labelEl.scrollHeight;
    // Pick the largest scale whose rotated width (= naturalHeight * scale)
    // still fits inside the usable width minus the breathing margin.
    const A4_SCALE = Math.min(1.15, (USABLE_W_PX - 2 * SIDE_BREATHING_PX) / naturalHeight);
    const scaledW = LABEL_W * A4_SCALE;        // design width after scale
    const scaledH = naturalHeight * A4_SCALE;   // design height after scale
    // After 90° CCW rotation, the on-page footprint is:
    const rotatedW = scaledH;                   // page horizontal extent
    const rotatedH = scaledW;                   // page vertical extent
    // Center horizontally inside the usable area.
    const offsetX = Math.max(0, (USABLE_W_PX - rotatedW) / 2);
    // Anchor to the BOTTOM of the usable area (small breathing margin).
    const offsetY = Math.max(0, USABLE_H_PX - rotatedH - BOTTOM_BREATHING_PX);

    const printStyle = doc.createElement("style");
    printStyle.textContent = `
      @page { margin: 10mm; size: A4 portrait; }
      html, body { margin: 0; padding: 0; background: #fff; }
      #print-wrapper {
        position: relative;
        width: ${USABLE_W_PX}px;
        height: ${USABLE_H_PX}px;
        margin: 0 auto;
      }
      #shipping-label-print {
        width: ${LABEL_W}px !important;
        max-width: ${LABEL_W}px !important;
        border: 1px solid #000 !important;
        font-family: Arial, Helvetica, sans-serif !important;
        font-size: 11px !important;
        line-height: 1.3 !important;
        background: #fff !important;
        color: #000 !important;
        box-sizing: border-box !important;
        position: absolute !important;
        top: 0 !important;
        left: 0 !important;
        transform-origin: 0 0 !important;
        /* 90° CCW rotation: design top → page LEFT.
           After rotate(-90deg) with origin (0,0) the visual content occupies
           x ∈ [0, scaledH], y ∈ [-scaledW, 0]. We translate by (offsetX,
           offsetY + scaledW) to move it into the visible region and place
           it at the bottom-center of the usable area. */
        transform: translate(${offsetX}px, ${offsetY + scaledW}px) rotate(-90deg) scale(${A4_SCALE}) !important;
      }
    `;
    doc.head.appendChild(printStyle);

    // Wrapper reserves the real usable area on the page so the absolutely-
    // positioned, scaled label is centered inside it instead of clipped.
    const wrapper = doc.createElement("div");
    wrapper.id = "print-wrapper";

    // Clone the label node into the print window (no innerHTML string injection)
    const clone = doc.importNode(labelEl, true);
    wrapper.appendChild(clone);
    doc.body.appendChild(wrapper);

    // Wait for images/barcodes to render before printing
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    }, 500);
  };

  const handleSavePDF = async () => {
    const { default: jsPDF } = await import("jspdf");

    // ── A4 layout (label rotated 90° CCW, anchored to BOTTOM of A4) ──
    // Use a real A4 PORTRAIT page (210 × 297 mm) with a 10 mm margin on every
    // side, matching the print output. The label itself is drawn unchanged at
    // its original 105 mm design width (W) and natural design height (H),
    // then a 90° COUNTER-CLOCKWISE rotation is applied so the label appears
    // in LANDSCAPE orientation on the A4 page. The rotated label is anchored
    // to the BOTTOM of the usable area and centered horizontally; the upper
    // portion of the A4 page is left blank/white.
    //
    // After a 90° CCW rotation, the label's on-page footprint becomes:
    //   rotatedW = H * scale   (design height → page horizontal extent)
    //   rotatedH = W * scale   (design width  → page vertical   extent)
    // We pick `scale` so that rotatedW fits inside the 190 mm usable width
    // with a small breathing margin on each side.
    const PAGE_W = 210;
    const PAGE_H = 297;
    const MARGIN = 10;
    const USABLE_W = PAGE_W - 2 * MARGIN; // 190 mm
    const USABLE_H = PAGE_H - 2 * MARGIN; // 277 mm
    const ROTATED_BREATHING = 4;          // mm of breathing room each side after rotation
    const BOTTOM_BREATHING = 4;          // mm of breathing room below the rotated label

    // Original design width of the label drawing code (do not change —
    // all coordinates below assume this).
    const W = 105;
    const pad = 4;
    const CONTACT_W = 34;        // right panel width for contact
    const ORIGIN_W  = 22;        // right panel width for origin
    const addrMaxW  = W - CONTACT_W - pad - 3;  // max width for address lines
    // PDF_SCALE is now computed AFTER we know the label height H, see below.
    // (Forward declaration so the pre-wrap code that uses PDF_SCALE still compiles.)
    let PDF_SCALE = 1;

    // Pre-wrap address lines so we know how many rows each section needs.
    // Wrap widths are SCALED (real page mm) so wrapping matches what the
    // real doc renders at the scaled font size.
    //
    // NOTE: At this point PDF_SCALE is still 1 — we won't know the real
    // scale until we know the design height H (which depends on wrapping).
    // To break the chicken-and-egg cycle we pre-wrap at scale = 1 using
    // the unscaled font size, then re-wrap once more after computing the
    // final scale. Empirically the wrap widths in design-mm do not change
    // (they are derived from W, ORIGIN_W, pad — all constants), and the
    // number of wrapped lines is identical because the *ratio* of
    // text width / box width is scale-invariant.
    const PRE_WRAP_FONT = 7.5;
    const tmp = new jsPDF({ unit: "mm", format: [W, 300] });
    tmp.setFont("helvetica", "normal"); tmp.setFontSize(PRE_WRAP_FONT);

    // Wrap in DESIGN-mm units (scale=1). The wrapped line count equals
    // what the scaled rendering will produce because both font size and
    // wrap width scale by the same factor.
    const sndWrapped: string[] = sndLines.flatMap(ln =>
      tmp.splitTextToSize(ln, (W - ORIGIN_W - pad - 3)));
    const rcvWrapped: string[] = rcvLines.flatMap(ln =>
      tmp.splitTextToSize(ln, addrMaxW));

    const LINE_H = 3.6;
    // FIX (name/phone overflow): the 9.5pt sender/receiver names were drawn
    // as ONE unwrapped line and could run underneath the contact panel
    // (FROM) or the vertical divider (TO); long phone numbers overflowed the
    // narrow 22/34mm contact columns onto the label border. Pre-wrap the
    // main names (max 2 lines) and grow the section heights accordingly.
    const NAME_LINE_H = 4.6;
    tmp.setFont("helvetica", "bold"); tmp.setFontSize(9.5);
    const sndNameMain: string[] = String(parcel.sender_name || "").trim()
      ? (tmp.splitTextToSize(String(parcel.sender_name), W - ORIGIN_W - pad - 3) as string[]).slice(0, 2)
      : [];
    const rcvNameMain: string[] = String(parcel.receiver_name || "").trim()
      ? (tmp.splitTextToSize(String(parcel.receiver_name), addrMaxW) as string[]).slice(0, 2)
      : [];
    tmp.setFont("helvetica", "normal"); tmp.setFontSize(PRE_WRAP_FONT); // restore for the re-wrap below
    const fromNameExtra = Math.max(0, sndNameMain.length - 1) * NAME_LINE_H;
    const toNameExtra   = Math.max(0, rcvNameMain.length - 1) * NAME_LINE_H;
    const fromBodyH = Math.max(0, (sndWrapped.slice(0, 6).length) * LINE_H);
    const toBodyH   = Math.max(0, (rcvWrapped.slice(0, 7).length) * LINE_H);

    // hdrH bumped from 25 -> 29 to make room for the website line under the date
    const hdrH  = 29;
    // Minimums raised 24 -> 27 / 28 -> 30 so the contact column can hold up
    // to 3 wrapped name lines + 2 wrapped phone lines without overflowing.
    const fromH = Math.max(27, 13 + fromNameExtra + fromBodyH + 4);
    const toH   = Math.max(30, 13 + toNameExtra   + toBodyH   + 4);
    const barH  = 8;
    const refH  = 11;
    const wH    = 15;
    const bcH   = 17;   // barcode image height
    const H = hdrH + fromH + toH + barH + refH + wH + 4 + (bcH + 7) * 2 + 6;

    // ── Final scale, now that we know H (the design height) ──
    // After 90° CCW rotation, the rotated label's page width = H * scale.
    // We pick `scale` so this fits inside USABLE_W with breathing margin.
    PDF_SCALE = (USABLE_W - 2 * ROTATED_BREATHING) / H;

    // ── Real doc ──
    // A4 PORTRAIT page; label is drawn rotated 90° CCW inside it.
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: [PAGE_W, PAGE_H] });

    // Re-wrap at the SCALED font size so the real rendered lines exactly
    // match the pre-computed row counts (fromBodyH / toBodyH). Because the
    // ratio text-width/wrap-width is scale-invariant, this re-wrap produces
    // the same number of lines — but the lines themselves are computed at
    // the actual font size used by the real doc, eliminating any drift.
    tmp.setFontSize(PRE_WRAP_FONT * PDF_SCALE);
    const sndWrappedScaled: string[] = sndLines.flatMap(ln =>
      tmp.splitTextToSize(ln, (W - ORIGIN_W - pad - 3) * PDF_SCALE));
    const rcvWrappedScaled: string[] = rcvLines.flatMap(ln =>
      tmp.splitTextToSize(ln, addrMaxW * PDF_SCALE));
    // Swap in the scaled wraps (line counts are identical to the unscaled
    // versions, so fromBodyH / toBodyH are still valid).
    while (sndWrapped.length) sndWrapped.pop();
    sndWrapped.push(...sndWrappedScaled);
    while (rcvWrapped.length) rcvWrapped.pop();
    rcvWrapped.push(...rcvWrappedScaled);

    // ── Rotation math (90° CCW) ──
    // For a 90° counter-clockwise rotation around the design's top-left:
    //   design top edge  (y=0) → page LEFT   edge of the rotated footprint
    //   design right edge (x=W) → page TOP    edge of the rotated footprint
    //   design bottom  edge (y=H) → page RIGHT  edge of the rotated footprint
    //   design left edge  (x=0) → page BOTTOM edge of the rotated footprint
    //
    // Mapping a design point (x, y) to page coordinates:
    //   page_x = _originX + y       * _scale      (design Y → page X)
    //   page_y = _originY + (W - x) * _scale      (design X → page Y, flipped)
    //
    // After rotation, design's horizontal extents become vertical and vice
    // versa, so for axis-aligned primitives we also swap (w, h):
    //   design rect (x, y, w, h) → page rect at
    //     (_originX + y*_scale, _originY + (W-x-w)*_scale)  size (h*_scale, w*_scale)
    //   design horizontal line at y from x=0 to x=W → page VERTICAL line at
    //     x = _originX + y*_scale, from y=_originY to y=_originY + W*_scale
    const _scale = PDF_SCALE;
    const rotatedW = H * _scale;                  // page horizontal extent
    const rotatedH = W * _scale;                  // page vertical   extent
    // Center horizontally inside the usable area.
    const _originX = MARGIN + (USABLE_W - rotatedW) / 2;
    // Anchor to BOTTOM of usable area, with a small breathing margin.
    const _originY = MARGIN + (USABLE_H - rotatedH) - BOTTOM_BREATHING;

    // Bind originals BEFORE installing overrides (so the overrides can call
    // the originals with already-transformed coords without infinite
    // recursion).
    const _origLine = doc.line.bind(doc);
    const _origRect = doc.rect.bind(doc);
    const _origAddImage = doc.addImage.bind(doc);
    const _origText = doc.text.bind(doc);

    // Transform helpers: convert original-design (x, y, w, h) in mm into
    // A4 page coordinates with rotation + scale.
    // NOTE: page X depends on design Y, and page Y depends on design X
    // (rotation couples them). All callers below pass BOTH x and y so the
    // helpers can compute the correct page coordinate.
    const pdfPx = (y: number) => _originX + y * _scale;            // design Y → page X
    const pdfPy = (x: number) => _originY + (W - x) * _scale;     // design X → page Y
    const pdfPs = (v: number) => v * _scale;                       // scalar scale

    // Fill a design-space rectangle. After 90° CCW rotation it becomes a
    // page rect at (pdfPx(y), pdfPy(x+w)) with swapped w/h.
    const fillRect = (x: number, y: number, w: number, h: number, r: number, g: number, b: number) => {
      doc.setFillColor(r, g, b);
      // design top-left (x,   y) → page (pdfPx(y),         pdfPy(x))
      // design top-right (x+w, y) → page (pdfPx(y),         pdfPy(x+w))
      // → page rect top-left = (pdfPx(y), pdfPy(x+w)), size (h*scale, w*scale)
      _origRect(pdfPx(y), pdfPy(x + w), h * _scale, w * _scale, "F");
    };
    // Horizontal line in design → VERTICAL line on page (after rotation).
    const hline = (y: number, lw = 0.3, r = 0, g = 0, b = 0) => {
      doc.setDrawColor(r, g, b); doc.setLineWidth(lw * _scale);
      // design (0, y) → page (pdfPx(y), pdfPy(0)   = _originY + W*scale)
      // design (W, y) → page (pdfPx(y), pdfPy(W)   = _originY)
      _origLine(pdfPx(y), _originY, pdfPx(y), _originY + W * _scale);
    };
    // Text — positioned at the rotated page location, and rotated 90° CCW
    // (angle = 90 in jsPDF) so glyphs read correctly when viewing the
    // rotated label.
    const txt = (s: string | string[], x: number, y: number, opts?: any) => {
      // FIX (overlapping centered text): jsPDF implements align:"center" by
      // shifting the PAGE-X coordinate (x -= lineWidth / 2) BEFORE the 90°
      // rotation is applied. On this rotated label that shift lands on the
      // axis PERPENDICULAR to the text baseline, so every centered string
      // floated UP by half its own text width — barcode captions rose into
      // the barcode images above them, Day/Time values rose into their
      // captions, weight values rose into the caption row, and the DOX/
      // NON-DOX badge drifted inside its black box. The wider the string,
      // the bigger the overlap.
      //
      // Fix: center OURSELVES along the design-X axis (the baseline
      // direction) and always let jsPDF draw left-aligned, so its broken
      // align+angle interaction is never triggered.
      const newOpts = { ...(opts || {}) };
      const align = newOpts.align;
      delete newOpts.align; // never let jsPDF center rotated text
      let drawX = x;
      if (align === "center" && typeof s === "string" && s.length > 0) {
        // getTextWidth() returns the width at the CURRENT (already scaled)
        // font size in page-mm — divide by the scale to get design-mm.
        const wDesign = doc.getTextWidth(s) / _scale;
        drawX = x - wDesign / 2;
      }
      const pageX = pdfPx(y);
      const pageY = pdfPy(drawX);
      return _origText(s as any, pageX, pageY, { ...newOpts, angle: 90 });
    };
    const sf = (style: string, size: number, r = 0, g = 0, b = 0) => {
      // Font size is scaled so text stays proportional with the drawing.
      doc.setFont("helvetica", style); doc.setFontSize(size * _scale); doc.setTextColor(r, g, b);
    };
    // Override addImage so existing barcode addImage calls get transformed
    // AND rotated 90° CCW to match the rest of the label.
    //
    // EMPIRICALLY VERIFIED jsPDF behaviour for `addImage(x, y, w, h, ..., rotation=90)`:
    //   - jsPDF uses (x, y+h) — the BOTTOM-LEFT corner of the original image —
    //     as the rotation anchor (NOT (x, y)).
    //   - The rotation matrix output to the PDF is `0 1 -1 0 0 0`,
    //     which is a 90° counter-clockwise (visual CCW) rotation.
    //   - After rotation, the on-page rect (jsPDF Y-DOWN coords) becomes:
    //       x ∈ [x - h, x]            (image extends LEFT of anchor by h)
    //       y ∈ [y + h - w, y + h]   (image extends UP from y+h-w to y+h)
    //     i.e. width = h, height = w (swapped from original).
    //
    // For our design rotation (visual CCW), we want the rotated image to
    // occupy the page rect:
    //       x ∈ [pdfPx(y), pdfPx(y+h)]       width = h * scale
    //       y ∈ [pdfPy(x+w), pdfPy(x)]       height = w * scale
    //
    // Matching against jsPDF's behaviour (anchor = (x_param, y_param + h_param)):
    //   x_param            = pdfPx(y + h)                       (right edge of desired rect)
    //   y_param + h_param  = pdfPy(x)        → y_param = pdfPy(x) - h * scale  (bottom edge)
    //   w_param            = w * scale                          (unrotated image width)
    //   h_param            = h * scale                          (unrotated image height)
    doc.addImage = (data: any, format: string, x: number, y: number, w: number, h: number, alias?: any, compression?: any, _rotation?: any) => {
      return _origAddImage(data, format, pdfPx(y + h), pdfPy(x) - h * _scale, w * _scale, h * _scale, alias, compression, 90);
    };
    // Override line() and rect() so any direct calls elsewhere in the code
    // (e.g. the vertical divider, outer border) also get transformed.
    doc.line = (x1: number, y1: number, x2: number, y2: number, style?: string) => {
      // design (x1,y1) → page (pdfPx(y1), pdfPy(x1))
      // design (x2,y2) → page (pdfPx(y2), pdfPy(x2))
      return _origLine(pdfPx(y1), pdfPy(x1), pdfPx(y2), pdfPy(x2), style);
    };
    doc.rect = (x: number, y: number, w: number, h: number, style?: string) => {
      // Same as fillRect above, but respects the `style` argument.
      return _origRect(pdfPx(y), pdfPy(x + w), h * _scale, w * _scale, style);
    };
    // getTextWidth depends on current font size — already scaled via sf().
    // splitTextToSize is independent of scale (it works in mm units) so we
    // leave it alone, but its results are interpreted in design-mm, which
    // is what the original code expects.

    // â”€â”€ logo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // FIX: previously the logo was force-fit into a fixed width AND fixed height
    // box with doc.addImage(), which ignores the source image's real aspect
    // ratio and stretches/squashes it â€” this is what produced the warped,
    // "rotated-looking" logo in the PDF. Now we measure the real image
    // dimensions and contain-fit it inside the box, centered, so it always
    // keeps its correct proportions.
    let logoDataUrl: string | null = null;
    let logoAspect = 1; // width / height
    try {
      const resp = await fetch(skyxpressLogo);
      const blob = await resp.blob();
      logoDataUrl = await new Promise<string>((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result as string);
        fr.onerror = () => rej(new Error("logo read failed"));
        fr.readAsDataURL(blob);
      });
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error("logo decode failed"));
        im.src = logoDataUrl as string;
      });
      if (img.naturalWidth && img.naturalHeight) {
        logoAspect = img.naturalWidth / img.naturalHeight;
      }
    } catch { /* ok â€” falls back to no logo */ }

    // â”€â”€ barcodes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const makeBC = (val: string) => {
      const c = document.createElement("canvas");
      try { JsBarcode(c, val, { format: "CODE128", height: 80, displayValue: false, margin: 4, background: "#fff", lineColor: "#000" }); } catch { /* */ }
      return c.toDataURL("image/png");
    };
    const barcodeRef = parcel.reference_id || parcel.tracking_id;
    const refBC = makeBC(barcodeRef || "000000");
    const trkBC = makeBC(trackCode || "000000");

    // â”€â”€ outer border â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    doc.setDrawColor(0); doc.setLineWidth(0.4 * _scale); doc.rect(0, 0, W, H);

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // HEADER
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const doxW  = dox === "DOX" ? 18 : 22;
    const logoW = 26;
    const mainW = W - doxW - logoW;

    fillRect(mainW, 0, doxW, hdrH, 0, 0, 0);
    sf("bold", dox === "DOX" ? 13 : 9, 255, 255, 255);
    txt(dox, mainW + doxW / 2, hdrH / 2 + 2, { align: "center" });

    if (logoDataUrl) {
      // contain-fit the logo inside its box, preserving aspect ratio
      const boxW = logoW - 2;
      const boxH = hdrH - 4;
      let drawW = boxW;
      let drawH = boxW / logoAspect;
      if (drawH > boxH) {
        drawH = boxH;
        drawW = boxH * logoAspect;
      }
      const offX = mainW + doxW + 1 + (boxW - drawW) / 2;
      const offY = 2 + (boxH - drawH) / 2;
      doc.addImage(logoDataUrl, "PNG", offX, offY, drawW, drawH);
    }

    sf("bold", 13, 0, 0, 0);
    txt("EXPRESS WORLDWIDE", pad, 8);

    // service type badge
    sf("bold", 7, 255, 255, 255);
    const stBadgeW = Math.min((doc.getTextWidth(serviceType) / _scale) + 5, mainW - pad - 2);
    fillRect(pad, 11, stBadgeW, 5, 26, 26, 46);
    txt(serviceType, pad + 2.5, 15);

    sf("normal", 6.5, 90, 90, 90);
    txt(labelDate(createdDate), pad, hdrH - 6);

    // small website line under EXPRESS WORLDWIDE
    sf("normal", 6, 0, 51, 160);
    txt(WEBSITE, pad, hdrH - 2);

    hline(hdrH, 0.6);
    let y = hdrH;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // FROM / ORIGIN
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    sf("bold", 7, 60, 60, 60);
    txt("FROM:", pad, y + 5);
    sf("bold", 9.5, 0, 0, 0);
    // wrapped main name (max 2 lines) — same first baseline, stacks down
    let ny = y + 10.5;
    for (const ln of sndNameMain) { txt(ln, pad, ny); ny += NAME_LINE_H; }

    sf("normal", 7.5, 30, 30, 30);
    let fy = y + 15 + fromNameExtra;
    for (const ln of sndWrapped.slice(0, 6)) { txt(ln, pad, fy); fy += LINE_H; }

    sf("normal", 6.5, 90, 90, 90);
    txt("Contact:", W - ORIGIN_W + 1, y + 5);
    sf("bold", 8, 0, 0, 0);
    // Wrap at the SCALED width (in real page mm) so wrapped lines fit
    // the rendered box; then draw at the transformed anchor.
    const sndNameLines = doc.splitTextToSize(parcel.sender_name, (ORIGIN_W - 2) * _scale).slice(0, 3);
    txt(sndNameLines, W - ORIGIN_W + 1, y + 10);
    if (parcel.sender_phone) {
      sf("normal", 8, 30, 30, 30);
      // FIX: wrap the phone (max 2 lines) so long numbers stay inside the
      // 22mm origin column instead of running over the label border.
      const sndPhoneLines = doc.splitTextToSize(String(parcel.sender_phone), (ORIGIN_W - 2) * _scale).slice(0, 2);
      let sy = y + 10 + sndNameLines.length * LINE_H + 1;
      for (const ln of sndPhoneLines) { txt(ln, W - ORIGIN_W + 1, sy); sy += LINE_H; }
    }

    hline(y + fromH, 0.3, 160, 160, 160);
    y += fromH;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // TO / CONTACT
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    hline(y, 0.6);
    const cxLeft = W - CONTACT_W;

    sf("bold", 7, 60, 60, 60);
    txt("TO:", pad, y + 5);
    sf("bold", 9.5, 0, 0, 0);
    // wrapped main name (max 2 lines)
    let ry = y + 10.5;
    for (const ln of rcvNameMain) { txt(ln, pad, ry); ry += NAME_LINE_H; }

    sf("normal", 7.5, 30, 30, 30);
    let ty = y + 15 + toNameExtra;
    for (const ln of rcvWrapped.slice(0, 7)) { txt(ln, pad, ty); ty += LINE_H; }

    // vertical divider between address and contact
    doc.setDrawColor(200); doc.setLineWidth(0.2 * _scale);
    doc.line(cxLeft - 1, y, cxLeft - 1, y + toH);

    sf("normal", 6.5, 90, 90, 90);
    txt("Contact:", cxLeft + 1, y + 5);
    sf("bold", 8, 0, 0, 0);
    // wrap contact name if too long
    const cNameLines = doc.splitTextToSize(parcel.receiver_name, (CONTACT_W - 2) * _scale).slice(0, 3);
    txt(cNameLines, cxLeft + 1, y + 10.5);
    if (parcel.receiver_phone) {
      sf("normal", 8, 30, 30, 30);
      // FIX: wrap the phone (max 2 lines) so it stays inside the 34mm column.
      const rcvPhoneLines = doc.splitTextToSize(String(parcel.receiver_phone), (CONTACT_W - 2) * _scale).slice(0, 2);
      let py2 = y + 10.5 + cNameLines.length * LINE_H + 1;
      for (const ln of rcvPhoneLines) { txt(ln, cxLeft + 1, py2); py2 += LINE_H; }
    }

    hline(y + toH, 0.5);
    y += toH;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // SERVICE TYPE BAR
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    fillRect(0, y, W, barH, 0, 0, 0);
    sf("bold", 11, 255, 255, 255);
    txt(serviceType, pad, y + barH - 2);
    y += barH;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // REF / DAY / TIME
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    sf("normal", 8, 0, 0, 0);
    txt(`CNIC Shipper: ${cnicCode}`, pad, y + 7);

    // day column
    sf("bold", 6.5, 80, 80, 80);
    txt("Day", W - 36, y + 3.5, { align: "center" });
    sf("normal", 7, 0, 0, 0);
    txt(dayStr, W - 36, y + 8.5, { align: "center" });

    // time column
    sf("bold", 6.5, 80, 80, 80);
    txt("Time", W - 14, y + 3.5, { align: "center" });
    sf("normal", 7, 0, 0, 0);
    txt(timeStr, W - 14, y + 8.5, { align: "center" });

    hline(y + refH, 0.2, 200, 200, 200);
    y += refH;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // WEIGHT / PIECES  â€” labels on top, values below
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const colW = (W - pad) / 3;

    // Pce/Shpt  |  Weight  |  Piece
    sf("normal", 6.5, 90, 90, 90);
    txt("Pce/Shpt", pad + colW * 0 + 2, y + 5, { align: "left" });
    txt("Weight",   pad + colW * 1 + colW / 2, y + 5, { align: "center" });
    txt("Piece",    pad + colW * 2 + colW / 2, y + 5, { align: "center" });

    sf("bold", 15, 0, 0, 0);
    txt(`${weightKg} kg`, pad + colW * 1 + colW / 2, y + 13, { align: "center" });
    txt(`1/${pieces}`,    pad + colW * 2 + colW / 2, y + 13, { align: "center" });

    hline(y + wH, 0.2, 200, 200, 200);
    y += wH + 4;

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // BARCODES
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    const cntX  = pad + 65 + 3;   // contents start x
    const bcW   = 63;             // barcode image width

    // Upper â€” reference ID
    doc.addImage(refBC, "PNG", pad, y, bcW, bcH);
    sf("normal", 7, 0, 0, 0);
    txt(barcodeRef, pad + bcW / 2, y + bcH + 3.5, { align: "center" });

    sf("bold", 6.5, 60, 60, 60);
    txt("Contents:", cntX, y + 5);
    sf("normal", 6.5, 30, 30, 30);
    const cntWrapped = doc.splitTextToSize(contentsText.toUpperCase().slice(0, 80), (W - cntX - pad) * _scale);
    txt(cntWrapped, cntX, y + 9.5);

    y += bcH + 8;

    // Lower â€” tracking ID (full width for prominence)
    doc.addImage(trkBC, "PNG", pad, y, W - pad * 2, bcH);
    sf("normal", 7, 0, 0, 0);
    txt(trackCode, W / 2, y + bcH + 3.5, { align: "center" });

    // â”€â”€ save â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    doc.save(`SkyXpress_Label_${trackCode}.pdf`);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent
        className="max-w-2xl p-0 overflow-hidden bg-white"
        style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Shipping Label â€” {parcel.tracking_id}</DialogTitle>
        </DialogHeader>

        {/* Print controls â€” hidden when printing */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b print:hidden">
          <span className="text-sm font-semibold text-slate-700">Shipping Label Preview</span>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSavePDF} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white">
              <FileDown className="h-3.5 w-3.5" />
              Save PDF
            </Button>
            <Button size="sm" onClick={handlePrint} className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white">
              <Printer className="h-3.5 w-3.5" />
              Print
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose} className="gap-1.5 text-slate-500">
              <X className="h-3.5 w-3.5" />
              Close
            </Button>
          </div>
        </div>

        {/* â•â•â•â•â•â•â•â•â•â• LABEL BODY â•â•â•â•â•â•â•â•â•â• */}
        <div
          id="shipping-label-print"
          className="bg-white text-black"
          style={{
            width: "100%",
            maxWidth: 560,
            margin: "0 auto",
            padding: "0 0 8px 0",
            fontSize: 11,
            lineHeight: 1.3,
            border: "1px solid #000",
          }}
        >

          {/* â”€â”€ Header row â”€â”€ */}
          <div style={{ display: "flex", alignItems: "stretch", borderBottom: "2px solid #000" }}>
            {/* EXPRESS WORLDWIDE + service type + date + website */}
            <div style={{ flex: 1, padding: "8px 10px" }}>
              <div style={{ fontSize: 18, fontWeight: 900, letterSpacing: 0.5, lineHeight: 1.1 }}>
                EXPRESS WORLDWIDE
              </div>
              {/* Service type â€” styled accent line */}
              <div style={{
                display: "inline-block",
                marginTop: 4,
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: 2,
                textTransform: "uppercase",
                color: "#fff",
                background: "#1a1a2e",
                padding: "1px 7px",
                borderRadius: 2,
              }}>
                {serviceType}
              </div>
              {/* Date */}
              <div style={{
                marginTop: 4,
                fontSize: 9,
                fontWeight: 600,
                letterSpacing: 1.5,
                color: "#444",
                textTransform: "uppercase",
              }}>
                {labelDate(createdDate)}
              </div>
              {/* Website â€” small line under the date */}
              <div style={{
                marginTop: 2,
                fontSize: 8.5,
                fontWeight: 600,
                letterSpacing: 0.3,
                color: "#0033a0",
              }}>
                {WEBSITE}
              </div>
            </div>

            {/* DOX / NON DOX badge */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "#000", color: "#fff",
              padding: "6px 14px",
              fontSize: 16, fontWeight: 900, letterSpacing: 1,
              borderLeft: "2px solid #000",
            }}>
              {dox}
            </div>

            {/* Logo â€” fixed box, image contain-fit so it can never stretch/skew */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              borderLeft: "2px solid #000", padding: "4px 10px",
              width: 110, boxSizing: "border-box", overflow: "hidden",
            }}>
              <img
                src={skyxpressLogo}
                alt="SkyXpress"
                style={{
                  maxHeight: 52,
                  maxWidth: 100,
                  width: "auto",
                  height: "auto",
                  objectFit: "contain",
                  display: "block",
                  transform: "none",
                }}
              />
            </div>
          </div>

          {/* â”€â”€ From / Origin row â”€â”€ */}
          <div style={{ display: "flex", borderBottom: "1px solid #aaa", padding: "6px 10px 6px 10px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#333", marginBottom: 2 }}>
                From:
              </div>
              <div style={{ fontWeight: 700 }}>{parcel.sender_name}</div>
              {sndLines.map((line, i) => (
                <div key={i} style={{ fontSize: 10, color: "#222" }}>{line}</div>
              ))}
            </div>
            <div style={{ textAlign: "right", minWidth: 70 }}>
              <div style={{ fontSize: 9, color: "#333", marginBottom: 2 }}>Contact:</div>
              <div style={{ fontSize: 11, fontWeight: 700 }}>{parcel.sender_name}</div>
              <div style={{ fontSize: 11, color: "#222", marginTop: 2 }}>{parcel.sender_phone}</div>
            </div>
          </div>

          {/* â”€â”€ To / Contact row â”€â”€ */}
          <div style={{
            display: "flex", borderBottom: "1px solid #000",
            padding: "6px 10px",
            borderTop: "1px solid #000",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#333", marginBottom: 2 }}>
                To:
              </div>
              <div style={{ fontWeight: 700 }}>{parcel.receiver_name}</div>
              {rcvLines.map((line, i) => (
                <div key={i} style={{ fontSize: 10, color: "#222" }}>{line}</div>
              ))}
            </div>
            <div style={{ textAlign: "right", minWidth: 90, fontSize: 9 }}>
              <div style={{ color: "#333", marginBottom: 2 }}>Contact:</div>
              <div style={{ fontSize: 10, fontWeight: 700, wordBreak: "break-word" }}>
                {parcel.receiver_name}
              </div>
              <div style={{ fontSize: 10, color: "#222", marginTop: 2 }}>
                {parcel.receiver_phone}
              </div>
            </div>
          </div>

          {/* â”€â”€ Service type bar (black) â”€â”€ */}
          <div style={{
            background: "#000", color: "#fff",
            padding: "5px 10px",
            fontSize: 16, fontWeight: 900, letterSpacing: 1,
          }}>
            {serviceType}
          </div>

          {/* â”€â”€ Ref / Day / Time row â”€â”€ */}
          <div style={{ display: "flex", alignItems: "center", padding: "4px 10px", borderBottom: "1px solid #ccc" }}>
            <div style={{
              flex: 1, minWidth: 0, fontSize: 10,
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              paddingRight: 8,
            }}>
              CNIC Shipper: {cnicCode}
            </div>
            <div style={{ display: "flex", flexShrink: 0, gap: 20, fontSize: 9, color: "#555" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700 }}>Day</div>
                <div style={{ fontSize: 9, marginTop: 2, whiteSpace: "nowrap" }}>{dayStr}</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontWeight: 700 }}>Time</div>
                <div style={{ fontSize: 9, marginTop: 2 }}>{timeStr}</div>
              </div>
            </div>
          </div>

          {/* â”€â”€ Weight / Pieces row â”€â”€ */}
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "flex-end",
            padding: "4px 10px 6px", gap: 24, borderBottom: "1px solid #aaa",
          }}>
            <div style={{ flexShrink: 0, fontSize: 9, color: "#555" }}>Pce/Shpt</div>
            <div style={{ flexShrink: 0, textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#555" }}>Weight</div>
              <div style={{ fontSize: 20, fontWeight: 900, whiteSpace: "nowrap" }}>{weightKg} kg</div>
            </div>
            <div style={{ flexShrink: 0, textAlign: "center" }}>
              <div style={{ fontSize: 9, color: "#555" }}>Piece</div>
              <div style={{ fontSize: 20, fontWeight: 900, whiteSpace: "nowrap" }}>1/{pieces}</div>
            </div>
          </div>

          {/* â”€â”€ Barcodes section â”€â”€ */}
          <div style={{ padding: "8px 10px 4px" }}>
            {/* Upper barcode â€” reference ID */}
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ flex: 1 }}>
                <Barcode value={parcel.reference_id || parcel.tracking_id || "000000"} height={48} />
                <div style={{ textAlign: "center", fontSize: 9, marginTop: 2, letterSpacing: 0.5 }}>
                  {parcel.reference_id || parcel.tracking_id}
                </div>
              </div>
              <div style={{ flexShrink: 0, width: 110, maxWidth: 110, textAlign: "right", fontSize: 9, paddingTop: 4 }}>
                <div style={{ fontWeight: 700, marginBottom: 2 }}>Contents:</div>
                <div style={{ color: "#333", wordBreak: "break-word", textTransform: "uppercase" }}>
                  {contentsText.slice(0, 80)}
                </div>
              </div>
            </div>

            {/* Lower barcode â€” tracking ID */}
            <div style={{ marginTop: 8 }}>
              <Barcode value={trackCode || "000000"} height={48} />
              <div style={{ textAlign: "center", fontSize: 9, marginTop: 2, letterSpacing: 0.5 }}>
                {trackCode}
              </div>
            </div>
          </div>

        </div>
        {/* â•â•â•â•â•â•â•â•â•â• END LABEL â•â•â•â•â•â•â•â•â•â• */}

      </DialogContent>

      {/* â”€â”€ Print styles â”€â”€ */}
      <style>{`
        @media print {
          @page { margin: 10mm; size: A4 portrait; }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
          }
          body * { visibility: hidden !important; }
          #shipping-label-print,
          #shipping-label-print * { visibility: visible !important; }
          /* ROTATE the 560px label 90° CCW so it appears in LANDSCAPE
             orientation on the A4 PORTRAIT page, anchored to the BOTTOM,
             centered horizontally. The rest of the page is blank/white.

             This is a STATIC CSS fallback for Ctrl+P from the dialog. It
             assumes a typical label natural height of ~750px (the label's
             measured height in production). For EXACT positioning, use
             the "Print" button — it measures the actual height at run
             time and computes the precise transform.

             Computation (with scale = 0.85, naturalHeight = 750):
               scaledW = 560  * 0.85 = 476px   (design width  after scale)
               scaledH = 750  * 0.85 = 637.5px (design height after scale)
               rotatedW = scaledH = 637.5px   (page horizontal extent)
               rotatedH = scaledW = 476px     (page vertical   extent)
               USABLE_W = 718px, USABLE_H = 1046px (A4 - 10mm margins @ 96dpi)
               offsetX = (718 - 637.5) / 2 ≈ 40px (horizontal centering)
               offsetY = 1046 - 476 - 14    = 556px (bottom anchor + breathing)
               translate = (offsetX, offsetY + scaledW) = (40, 1032)px

             Sequence (applied right-to-left):
               1. scale(0.85)        — content shrinks, top-left stays at (0,0)
               2. rotate(-90deg)    — content rotates 90° CCW around (0,0);
                                      visual now occupies x∈[0, scaledH],
                                      y∈[-scaledW, 0]
               3. translate(40,1032)— moves visual to (40, 556)–(677, 1032),
                                      i.e. bottom-anchored & centered. */
          #shipping-label-print {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            bottom: auto !important;
            right: auto !important;
            width: 560px !important;
            max-width: 560px !important;
            border: 1px solid #000 !important;
            padding: 0 !important;
            margin: 0 !important;
            background: #fff !important;
            transform-origin: 0 0 !important;
            transform: translate(40px, 1032px) rotate(-90deg) scale(0.85) !important;
          }
        }
      `}</style>
    </Dialog>
  );
}
