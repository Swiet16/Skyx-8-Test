// @ts-nocheck
import * as XLSX from "xlsx";

interface Parcel {
  id: string;
  tracking_id: string;
  reference_id?: string;
  sender_name: string;
  sender_company?: string;
  sender_phone: string;
  sender_city?: string;
  sender_country?: string;
  receiver_name: string;
  receiver_company?: string;
  receiver_phone: string;
  receiver_address?: string;
  receiver_address_2?: string;
  receiver_city?: string;
  receiver_state?: string;
  receiver_postal_code?: string;
  receiver_country?: string;
  parcel_type: string;
  weight: number;
  pieces?: number;
  total_price: number;
  currency: string;
  service_type?: string;
  current_status: string;
  from_country: string;
  to_country: string;
  created_at: string;
  items?: Array<{ description: string; quantity: number; unit_price: number; total?: number }>;
}

function getBagLabel(parcel: Parcel): string {
  const pieces = parcel.pieces ?? 1;
  if (pieces <= 1) return "1";
  return `1 To ${pieces}`;
}

function getDescription(parcel: Parcel): string {
  if (parcel.items && parcel.items.length > 0) {
    return parcel.items.map((i) => i.description).filter(Boolean).join(", ");
  }
  return parcel.parcel_type || "";
}

function getCountryDisplay(code: string, countryMap: Record<string, string>): string {
  if (!code) return "";
  return countryMap[code] || code;
}

export function exportManifestToExcel(
  parcels: Parcel[],
  countryMap: Record<string, string>,
  filename?: string,
  manifestId?: string
): void {
  const wb = XLSX.utils.book_new();

  // ── Title / branding row ──────────────────────────────────────────────────
  const companyName = "SKYXPRESS INTERNATIONAL COURIER & CARGO";
  const manifestDate = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const idPart = manifestId ? `   Manifest ID: ${manifestId}` : "";

  const titleRow = [
    `${companyName} — SHIPMENT MANIFEST${idPart}   Date: ${manifestDate}   Total Parcels: ${parcels.length}`,
    "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
  ];

  // ── Column headers (matching the supplied template exactly) ───────────────
  const headers = [
    "SR",
    "HAWB",
    "SHIPPER",
    "CITY",
    "COUNTRY",
    "Consignee Name",
    "Consignee Address",
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
  ];

  // ── Data rows ─────────────────────────────────────────────────────────────
  const dataRows = parcels.map((parcel, index) => [
    index + 1,
    parcel.reference_id || parcel.tracking_id || "",
    parcel.sender_name || "",
    parcel.sender_city || "",
    getCountryDisplay(parcel.from_country, countryMap),
    parcel.receiver_name || "",
    [parcel.receiver_address, parcel.receiver_address_2].filter(Boolean).join(", "),
    parcel.receiver_city || "",
    parcel.receiver_postal_code || "",
    getCountryDisplay(parcel.to_country, countryMap),
    parcel.receiver_phone || "",
    getBagLabel(parcel),
    parcel.pieces ?? 1,
    Number(parcel.weight ?? 0),
    Number(parcel.total_price ?? 0),
    getDescription(parcel),
    // FIX: the TRACKING I'D column must show the parcel's TRACKING ID (the
    // SkyXpress tracking number) — NOT the reference_id. Previously this cell
    // was `reference_id || tracking_id`, so as long as a reference existed the
    // column always displayed the reference id, which is exactly the bug the
    // user reported ("tracking id section has the reference id written in it").
    // Tracking id is now primary; reference id is only a last-resort fallback
    // for the rare parcel that somehow has no tracking id at all.
    parcel.tracking_id || parcel.reference_id || "",
    parcel.service_type || "",
    "LABEL PASTED",
  ]);

  // ── Totals row ─────────────────────────────────────────────────────────────
  const totalWeight = parcels.reduce((s, p) => s + Number(p.weight ?? 0), 0);
  const totalValue  = parcels.reduce((s, p) => s + Number(p.total_price ?? 0), 0);
  const totalPkgs   = parcels.reduce((s, p) => s + (p.pieces ?? 1), 0);

  const totalsRow = [
    "TOTAL", "", "", "", "", "", "", "", "", "", "",
    "",
    totalPkgs,
    Number(totalWeight.toFixed(2)),
    Number(totalValue.toFixed(2)),
    "", "", "", "",
  ];

  // ── Build sheet ────────────────────────────────────────────────────────────
  const sheetData = [titleRow, headers, ...dataRows, totalsRow];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Column widths (characters)
  ws["!cols"] = [
    { wch: 5  }, // SR
    { wch: 14 }, // HAWB
    { wch: 22 }, // SHIPPER
    { wch: 14 }, // CITY
    { wch: 22 }, // COUNTRY
    { wch: 22 }, // Consignee Name
    { wch: 38 }, // Consignee Address
    { wch: 14 }, // CITY
    { wch: 10 }, // POST CODE
    { wch: 24 }, // COUNTRY
    { wch: 16 }, // CONTACT
    { wch: 8  }, // BAG
    { wch: 6  }, // PKGS
    { wch: 8  }, // Wt KGS
    { wch: 10 }, // VALUE $
    { wch: 40 }, // Description
    { wch: 22 }, // TRACKING I'D
    { wch: 12 }, // SERVICE
    { wch: 14 }, // LABEL
  ];

  // Merge title row across all 19 columns (A1:S1)
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 18 } }];

  // ── Cell styles ───────────────────────────────────────────────────────────
  const totalRows = sheetData.length;
  const totalCols = headers.length;

  const titleStyle = {
    font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A3A6B" } },           // SkyXpress navy
    alignment: { horizontal: "center", vertical: "center", wrapText: false },
  };

  const headerStyle = {
    font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "1A3A6B" } },
    alignment: { horizontal: "center", vertical: "center", wrapText: true },
    border: {
      top:    { style: "thin", color: { rgb: "FFFFFF" } },
      bottom: { style: "thin", color: { rgb: "FFFFFF" } },
      left:   { style: "thin", color: { rgb: "FFFFFF" } },
      right:  { style: "thin", color: { rgb: "FFFFFF" } },
    },
  };

  const evenRowStyle = {
    font: { sz: 9 },
    fill: { fgColor: { rgb: "EBF2FF" } },
    alignment: { vertical: "center", wrapText: false },
    border: {
      top:    { style: "hair", color: { rgb: "C7D8F5" } },
      bottom: { style: "hair", color: { rgb: "C7D8F5" } },
      left:   { style: "hair", color: { rgb: "C7D8F5" } },
      right:  { style: "hair", color: { rgb: "C7D8F5" } },
    },
  };

  const oddRowStyle = {
    font: { sz: 9 },
    fill: { fgColor: { rgb: "FFFFFF" } },
    alignment: { vertical: "center", wrapText: false },
    border: {
      top:    { style: "hair", color: { rgb: "C7D8F5" } },
      bottom: { style: "hair", color: { rgb: "C7D8F5" } },
      left:   { style: "hair", color: { rgb: "C7D8F5" } },
      right:  { style: "hair", color: { rgb: "C7D8F5" } },
    },
  };

  const totalsStyle = {
    font: { bold: true, sz: 10, color: { rgb: "FFFFFF" } },
    fill: { fgColor: { rgb: "F97316" } },           // SkyXpress orange
    alignment: { horizontal: "center", vertical: "center" },
    border: {
      top:    { style: "medium", color: { rgb: "EA6900" } },
      bottom: { style: "medium", color: { rgb: "EA6900" } },
      left:   { style: "medium", color: { rgb: "EA6900" } },
      right:  { style: "medium", color: { rgb: "EA6900" } },
    },
  };

  const numStyle = {
    ...oddRowStyle,
    alignment: { horizontal: "right", vertical: "center" },
    numFmt: "0.00",
  };

  function cellAddr(r: number, c: number) {
    return XLSX.utils.encode_cell({ r, c });
  }

  // Apply title style to row 0 (merged)
  ws[cellAddr(0, 0)] = { v: sheetData[0][0], t: "s", s: titleStyle };
  ws["!rows"] = [{ hpt: 24 }, { hpt: 28 }];

  // Apply header style to row 1
  for (let c = 0; c < totalCols; c++) {
    ws[cellAddr(1, c)] = { v: headers[c], t: "s", s: headerStyle };
  }

  // Apply alternating row styles to data rows (rows 2 .. totalRows-2)
  for (let r = 2; r < totalRows - 1; r++) {
    const isEven = (r - 2) % 2 === 0;
    const rowStyle = isEven ? evenRowStyle : oddRowStyle;
    for (let c = 0; c < totalCols; c++) {
      const cellVal = sheetData[r][c];
      const addr = cellAddr(r, c);
      const isNumber = typeof cellVal === "number";
      // Special numeric formatting for weight / value columns
      if (c === 13 || c === 14) {
        ws[addr] = { v: cellVal, t: "n", s: { ...numStyle, fill: isEven ? { fgColor: { rgb: "EBF2FF" } } : { fgColor: { rgb: "FFFFFF" } } } };
      } else {
        ws[addr] = { v: cellVal, t: isNumber ? "n" : "s", s: rowStyle };
      }
    }
  }

  // Apply totals style to last row
  const lastRow = totalRows - 1;
  for (let c = 0; c < totalCols; c++) {
    const cellVal = sheetData[lastRow][c];
    const isNumber = typeof cellVal === "number";
    ws[cellAddr(lastRow, c)] = { v: cellVal, t: isNumber ? "n" : "s", s: totalsStyle };
  }

  XLSX.utils.book_append_sheet(wb, ws, "MANIFEST");

  const outputName =
    filename ||
    `SkyXpress_Manifest_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, outputName);
}
