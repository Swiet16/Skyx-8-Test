// src/lib/manifestExport.ts
//
// Generates a courier-style Manifest (.xlsx) for a set of selected parcels,
// matching the layout, fonts, borders and column widths of the provided
// DMMY.XLSX template exactly (SR / HAWB / SHIPPER / ... / LABEL).
//
// Requires the "exceljs" package:
//   npm install exceljs

import ExcelJS from "exceljs";

// Minimal shape this module needs from a Parcel — kept separate from the
// app-wide Parcel type so this file has no compile-time dependency on it.
export interface ManifestParcel {
  tracking_id: string;
  reference_id?: string;
  sender_name: string;
  sender_company?: string;
  sender_city?: string;
  sender_country?: string;
  receiver_name: string;
  receiver_address?: string;
  receiver_address_2?: string;
  receiver_city?: string;
  receiver_postal_code?: string;
  receiver_country?: string;
  receiver_phone: string;
  pieces?: number;
  weight: number;
  total_price: number;
  parcel_type: string;
  service_type?: string;
  items?: Array<{ description: string; quantity?: number; unit_price?: number }>;
}

// --- Template constants, extracted from DMMY.XLSX -------------------------

const HEADERS = [
  "SR",
  "HAWB",
  "SHIPPER",
  "CITY",
  "COUNTRY",
  "ConsigneeName",
  "Consignee  Address",
  "CITY",
  "POST CODE",
  "COUNTRY",
  "CONTACT",
  "BAG",
  "PKGS",
  "Wt KGS",
  "VALUE $",
  "Description",
  "TRACKING I'D",
  "SERVICE",
  "LABEL",
] as const;

// Column widths (Excel character units), column-for-column from the template
const COLUMN_WIDTHS = [
  4, 10.29, 10.71, 9.71, 11.71, 19.29, 31.71, 11.43, 13.14, 31.29, 15.57, 7.57,
  6.86, 9, 10.14, 102.71, 25, 10.14, 16.71,
];

const HEADER_FILL_ARGB = "FFBFBFBF";
const VALUE_NUMFMT =
  '_-[$$-409]* #,##0.00_ ;_-[$$-409]* \\-#,##0.00\\ ;_-[$$-409]* "-"??_ ;_-@_ ';

const thin = { style: "thin" as const };
const medium = { style: "medium" as const };

/** Box border: medium on the outer top/left edges of the table, thin elsewhere. */
function cellBorder(isFirstRow: boolean, isFirstCol: boolean) {
  return {
    top: isFirstRow ? medium : thin,
    left: isFirstCol ? medium : thin,
    right: thin,
    bottom: thin,
  };
}

function joinNonEmpty(parts: Array<string | undefined | null>, sep = " ") {
  return parts.filter((p) => p && String(p).trim().length > 0).join(sep);
}

/**
 * Builds the manifest workbook for the given (already-selected) parcels,
 * in the order provided, and returns it as a downloadable Blob.
 */
export async function generateManifestExcel(
  parcels: ManifestParcel[],
  countryName: (code?: string) => string,
  sheetName = "MANIFEST"
): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Parcel Management";
  workbook.created = new Date();

  const ws = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 3 }], // keep header visible while scrolling
  });

  ws.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  // Rows 1–2 left blank (matches template spacing above the header table)
  ws.getRow(1).height = 15.75;
  ws.getRow(2).height = 15.75;

  // --- Header row (row 3) --------------------------------------------------
  const headerRow = ws.getRow(3);
  headerRow.height = 15.75;
  HEADERS.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.font = { name: "Cambria", size: 12, bold: true, color: { argb: "FF000000" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL_ARGB } };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.border = cellBorder(true, i === 0);
  });

  // --- Data rows (starting row 4) -----------------------------------------
  let totalPkgs = 0;
  let totalWeight = 0;
  let totalValue = 0;

  parcels.forEach((p, idx) => {
    const rowNum = 4 + idx;
    const row = ws.getRow(rowNum);
    row.height = 15.75;

    const description =
      p.items && p.items.length > 0
        ? joinNonEmpty(p.items.map((it) => it.description), ", ")
        : p.parcel_type || "";

    const consigneeAddress = joinNonEmpty([p.receiver_address, p.receiver_address_2]);
    const pkgs = p.pieces ?? 1;

    totalPkgs += pkgs;
    totalWeight += p.weight ?? 0;
    totalValue += p.total_price ?? 0;

    const values: Array<string | number> = [
      idx + 1, // SR
      p.reference_id || p.tracking_id, // HAWB
      p.sender_company || p.sender_name, // SHIPPER
      p.sender_city || "", // CITY
      countryName(p.sender_country), // COUNTRY
      p.receiver_name, // ConsigneeName
      consigneeAddress, // Consignee Address
      p.receiver_city || "", // CITY
      p.receiver_postal_code || "", // POST CODE
      countryName(p.receiver_country), // COUNTRY
      p.receiver_phone || "", // CONTACT
      "", // BAG (assigned manually at packing time)
      pkgs, // PKGS
      p.weight ?? 0, // Wt KGS
      p.total_price ?? 0, // VALUE $
      description, // Description
      // FIX: TRACKING I'D must show the tracking id (was `reference_id ||
      // tracking_id`, which always displayed the reference id here).
      p.tracking_id || p.reference_id, // TRACKING I'D
      p.service_type || "", // SERVICE
      "", // LABEL (checked off manually)
    ];

    values.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.font = { name: "Cambria", size: 12 };
      cell.alignment = {
        horizontal: "left",
        vertical: "top",
        wrapText: i === 6 || i === 15, // Address & Description columns wrap
      };
      cell.border = cellBorder(false, i === 0);
      if (i === 14) cell.numFmt = VALUE_NUMFMT; // VALUE $
    });
  });

  // --- Totals row -----------------------------------------------------------
  const totalsRowNum = 4 + parcels.length;
  const totalsRow = ws.getRow(totalsRowNum);
  totalsRow.height = 15.75;
  const totalsLabelCell = totalsRow.getCell(12); // under BAG, spanning into PKGS
  totalsLabelCell.value = "TOTAL";
  totalsLabelCell.font = { name: "Cambria", size: 12, bold: true };
  totalsLabelCell.border = cellBorder(false, false);

  [
    { col: 13, val: totalPkgs },
    { col: 14, val: totalWeight },
    { col: 15, val: totalValue, fmt: VALUE_NUMFMT },
  ].forEach(({ col, val, fmt }) => {
    const cell = totalsRow.getCell(col);
    cell.value = val;
    cell.font = { name: "Cambria", size: 12, bold: true };
    cell.alignment = { horizontal: "left", vertical: "top" };
    cell.border = cellBorder(false, false);
    if (fmt) cell.numFmt = fmt;
  });
  // fill remaining totals-row cells with a matching border so the box stays closed
  for (let c = 1; c <= HEADERS.length; c++) {
    if (c === 12 || c === 13 || c === 14 || c === 15) continue;
    const cell = totalsRow.getCell(c);
    cell.border = cellBorder(false, c === 1);
    cell.font = { name: "Cambria", size: 12 };
  }

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return new Blob([arrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Triggers a browser download of the given blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Convenience helper: build + download in one call. */
export async function exportManifest(
  parcels: ManifestParcel[],
  countryName: (code?: string) => string,
  filename?: string
) {
  const blob = await generateManifestExcel(parcels, countryName);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, filename || `Manifest_${stamp}.xlsx`);
}
