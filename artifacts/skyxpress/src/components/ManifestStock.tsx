// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
// Sheet removed — manifest detail now renders inline on the page
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  FileSpreadsheet, FileDown, Trash2, Search, ClipboardList, Package,
  Weight, DollarSign, Calendar, RefreshCw, Lock, Unlock, Copy,
  Plane, MapPin, Clock, Building2, Database, Plus, X, CheckCircle2,
  ChevronDown, FileText, History, Download, Tag, Zap, Truck, Home,
  RotateCcw, Square, CheckSquare, ListChecks, Check, ChevronsUpDown,
  Archive, Box, Edit2, User, AlertCircle, UploadCloud,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  loadManifestStockDB, saveManifestToStockDB, updateManifestInStockDB,
  deleteManifestFromStockDB, saveManifestHistory, loadManifestHistory,
  fetchLicenses, createLicense,
  type ManifestStockEntry, type ManifestHistoryEntry,
} from "@/utils/manifestStorage";
import { exportManifestToExcel } from "@/utils/manifestExport";
import { generateBulkManifestPDF } from "@/utils/bulkManifestPDF";
import { supabase } from "@/integrations/supabase/client";

// ── Resilient parcel row update (manifest → parcels status sync) ─────────────
// ROOT CAUSE of "manifest status changes never reach the parcels": the sync
// writes optional columns (admin_note, status_notes, current_location,
// last_location, detailed_status) that many production databases do not have
// yet. PostgREST rejects the WHOLE update with PGRST204 ("Could not find the
// 'x' column of 'parcels' in the schema cache"), so `current_status` never
// landed and parcels kept showing "processing".
//
// Fix: try the full patch first. If the database is missing one of the
// optional columns, retry with the CORE patch (current_status + updated_at +
// status_timeline — present on every schema) so the status itself ALWAYS
// syncs. The caller is told a fallback happened so it can advise running
// `supabase-parcels-status-sync.sql` to unlock comment/location mirroring.
const PARCEL_CORE_PATCH_KEYS = ["current_status", "updated_at", "status_timeline"];

function isSchemaColumnError(error: { code?: string | number; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? "");
  const msg = (error.message ?? "").toLowerCase();
  return (
    code === "PGRST204" ||
    code === "42703" ||
    msg.includes("could not find the") ||
    (msg.includes("column") && msg.includes("does not exist")) ||
    msg.includes("schema cache")
  );
}

async function updateParcelRowResilient(
  rowId: string,
  patch: Record<string, any>
): Promise<{ ok: boolean; error?: string; schemaFallback: boolean }> {
  const { error } = await supabase.from("parcels").update(patch).eq("id", rowId);
  if (!error) return { ok: true, schemaFallback: false };

  // Non-schema errors (RLS denial, network, etc.) are reported as-is — the
  // toast will surface them and the admin can fix permissions.
  if (!isSchemaColumnError(error)) {
    return { ok: false, error: error.message || "Unknown parcels update error", schemaFallback: false };
  }

  console.warn(
    `[ManifestStock] parcels table is missing optional sync columns — retrying with core columns only. ` +
    `Run supabase-parcels-status-sync.sql in the Supabase SQL Editor to enable comment/location mirroring. ` +
    `Original error: ${error.message}`
  );

  const core: Record<string, any> = {};
  PARCEL_CORE_PATCH_KEYS.forEach((k) => {
    if (k in patch) core[k] = patch[k];
  });
  const { error: coreErr } = await supabase.from("parcels").update(core).eq("id", rowId);
  if (coreErr) {
    return { ok: false, error: coreErr.message || "Core status sync failed", schemaFallback: true };
  }
  return { ok: true, schemaFallback: true };
}


// ── Constants ─────────────────────────────────────────────────────────────────
const ORIGIN_HUBS = [
  "GRT - GUJRAT", "LHE - LAHORE", "KHI - KARACHI", "ISB - ISLAMABAD",
  "MUL - MULTAN", "FSD - FAISALABAD", "PEW - PESHAWAR", "QTA - QUETTA",
  "HYD - HYDERABAD", "SKT - SIALKOT", "GUJ - GUJRANWALA", "BHW - BAHAWALPUR",
  "ABT - ABBOTTABAD", "MGW - MARDAN", "SWL - SWAT", "SHW - SAHIWAL",
  "RYK - RAHIM YAR KHAN", "SKP - SARGODHA", "CHW - CHINIOT", "JGW - JHANG",
  "MFD - MIANWALI", "CTD - CHARSADDA", "HAR - HARIPUR", "NWS - NOWSHERA",
  "DGK - DERA GHAZI KHAN", "ZAH - ZHOB", "TUR - TURBAT", "SUI - SUI",
  "AZK - AZAD KASHMIR", "MZD - MUZAFFARABAD", "MND - MIRPUR", "BBN - ABBOTTABAD",
  "LRK - LARKANA", "SKD - SUKKUR", "NWB - NAWABSHAH", "MRI - MIRPURKHAS",
  "TND - TANDO ALLAHYAR", "JBO - JACOBABAD", "SHD - SHIKARPUR",
];
const DEST_HUBS = [
  // Europe
  "UK - LONDON HUB", "UK BRANCH - MCS UK", "SCOTLAND - GLASGOW HUB",
  "IRELAND - DUBLIN HUB", "FRANCE - PARIS HUB", "GERMANY - FRANKFURT HUB",
  "SPAIN - MCS ESP", "ITALY - MCS ITA", "NETHERLANDS - AMSTERDAM HUB",
  "BELGIUM - BRUSSELS HUB", "SWITZERLAND - ZURICH HUB", "AUSTRIA - VIENNA HUB",
  "SWEDEN - STOCKHOLM HUB", "NORWAY - OSLO HUB", "DENMARK - COPENHAGEN HUB",
  "FINLAND - HELSINKI HUB", "PORTUGAL - LISBON HUB", "GREECE - ATHENS HUB",
  "TURKEY - ISTANBUL HUB", "POLAND - WARSAW HUB", "CZECH REPUBLIC - PRAGUE HUB",
  "HUNGARY - BUDAPEST HUB", "ROMANIA - BUCHAREST HUB", "BULGARIA - SOFIA HUB",
  "CROATIA - ZAGREB HUB", "SERBIA - BELGRADE HUB", "SLOVAKIA - BRATISLAVA HUB",
  "UKRAINE - KYIV HUB", "RUSSIA - MOSCOW HUB", "MALTA - VALLETTA HUB",
  "CYPRUS - NICOSIA HUB", "LUXEMBOURG - LUX HUB", "ESTONIA - TALLINN HUB",
  "LATVIA - RIGA HUB", "LITHUANIA - VILNIUS HUB", "ICELAND - REYKJAVIK HUB",
  // Americas
  "USA BRANCH - MCS USA", "USA - NEW YORK HUB", "USA - LOS ANGELES HUB",
  "USA - CHICAGO HUB", "USA - HOUSTON HUB", "USA - MIAMI HUB",
  "USA - DALLAS HUB", "USA - ATLANTA HUB", "USA - WASHINGTON DC HUB",
  "CANADA - MCS CAN", "CANADA - TORONTO HUB", "CANADA - VANCOUVER HUB",
  "CANADA - MONTREAL HUB", "CANADA - CALGARY HUB",
  "MEXICO - MEXICO CITY HUB", "BRAZIL - SAO PAULO HUB", "BRAZIL - RIO HUB",
  "ARGENTINA - BUENOS AIRES HUB", "CHILE - SANTIAGO HUB",
  "COLOMBIA - BOGOTA HUB", "PERU - LIMA HUB", "VENEZUELA - CARACAS HUB",
  "ECUADOR - QUITO HUB", "BOLIVIA - LA PAZ HUB", "URUGUAY - MONTEVIDEO HUB",
  "PARAGUAY - ASUNCION HUB", "PANAMA - PANAMA CITY HUB",
  "COSTA RICA - SAN JOSE HUB", "GUATEMALA - GUATEMALA CITY HUB",
  "JAMAICA - KINGSTON HUB", "TRINIDAD - PORT OF SPAIN HUB",
  "BAHAMAS - NASSAU HUB", "BARBADOS - BRIDGETOWN HUB",
  // Middle East
  "UAE - MCS UAE", "UAE - DUBAI HUB", "UAE - ABU DHABI HUB",
  "SAUDI - MCS SAU", "SAUDI - RIYADH HUB", "SAUDI - JEDDAH HUB",
  "SAUDI - DAMMAM HUB", "KUWAIT - KUWAIT CITY HUB", "QATAR - DOHA HUB",
  "BAHRAIN - MANAMA HUB", "OMAN - MUSCAT HUB", "JORDAN - AMMAN HUB",
  "IRAQ - BAGHDAD HUB", "IRAN - TEHRAN HUB", "LEBANON - BEIRUT HUB",
  "SYRIA - DAMASCUS HUB", "ISRAEL - TEL AVIV HUB", "YEMEN - SANAA HUB",
  // Asia Pacific
  "AUSTRALIA - MCS AUS", "AUSTRALIA - SYDNEY HUB", "AUSTRALIA - MELBOURNE HUB",
  "AUSTRALIA - BRISBANE HUB", "AUSTRALIA - PERTH HUB",
  "NEW ZEALAND - AUCKLAND HUB", "NEW ZEALAND - WELLINGTON HUB",
  "CHINA - BEIJING HUB", "CHINA - SHANGHAI HUB", "CHINA - GUANGZHOU HUB",
  "CHINA - SHENZHEN HUB", "HONG KONG - HK HUB",
  "JAPAN - TOKYO HUB", "JAPAN - OSAKA HUB",
  "SOUTH KOREA - SEOUL HUB", "TAIWAN - TAIPEI HUB",
  "SINGAPORE - SINGAPORE HUB", "MALAYSIA - KUALA LUMPUR HUB",
  "THAILAND - BANGKOK HUB", "INDONESIA - JAKARTA HUB",
  "PHILIPPINES - MANILA HUB", "VIETNAM - HO CHI MINH HUB",
  "VIETNAM - HANOI HUB", "CAMBODIA - PHNOM PENH HUB",
  "MYANMAR - YANGON HUB", "BANGLADESH - DHAKA HUB",
  "SRI LANKA - COLOMBO HUB", "INDIA - NEW DELHI HUB",
  "INDIA - MUMBAI HUB", "INDIA - BANGALORE HUB", "INDIA - CHENNAI HUB",
  "NEPAL - KATHMANDU HUB", "MALDIVES - MALE HUB",
  "AFGHANISTAN - KABUL HUB", "TAJIKISTAN - DUSHANBE HUB",
  "UZBEKISTAN - TASHKENT HUB", "KAZAKHSTAN - ALMATY HUB",
  "KYRGYZSTAN - BISHKEK HUB", "TURKMENISTAN - ASHGABAT HUB",
  "AZERBAIJAN - BAKU HUB", "GEORGIA - TBILISI HUB",
  "ARMENIA - YEREVAN HUB",
  // Africa
  "SOUTH AFRICA - JOHANNESBURG HUB", "SOUTH AFRICA - CAPE TOWN HUB",
  "NIGERIA - LAGOS HUB", "NIGERIA - ABUJA HUB",
  "KENYA - NAIROBI HUB", "ETHIOPIA - ADDIS ABABA HUB",
  "GHANA - ACCRA HUB", "TANZANIA - DAR ES SALAAM HUB",
  "UGANDA - KAMPALA HUB", "ZAMBIA - LUSAKA HUB",
  "ZIMBABWE - HARARE HUB", "EGYPT - CAIRO HUB", "EGYPT - ALEXANDRIA HUB",
  "MOROCCO - CASABLANCA HUB", "MOROCCO - RABAT HUB",
  "TUNISIA - TUNIS HUB", "ALGERIA - ALGIERS HUB",
  "LIBYA - TRIPOLI HUB", "SUDAN - KHARTOUM HUB",
  "SENEGAL - DAKAR HUB", "IVORY COAST - ABIDJAN HUB",
  "CAMEROON - DOUALA HUB", "ANGOLA - LUANDA HUB",
  "MOZAMBIQUE - MAPUTO HUB", "MAURITIUS - PORT LOUIS HUB",
  "RWANDA - KIGALI HUB", "BOTSWANA - GABORONE HUB",
  "NAMIBIA - WINDHOEK HUB", "MALAWI - LILONGWE HUB",
];
const SERVICES = [
  "Express", "Standard", "Economy", "Same Day", "Next Day", "Overnight", "Priority",
  "Freight", "Cargo", "DHL PK", "UPS PK", "SKYNET", "DPD UK",
  "DHL via UK", "UPS via Belfast", "UPS Saver",
];
const BAG_TYPES  = ["Standard Bag", "Heavy Duty Bag", "Cardboard Box", "Wooden Crate", "Pallet", "Sack", "Drum", "Tube/Roll"];
const BAG_SIZES  = ["Extra Small (XS)", "Small (S)", "Medium (M)", "Large (L)", "Extra Large (XL)", "XXL", "Custom"];
const SEAL_TYPES = ["Plastic Seal", "Metal Seal", "Zip Tie", "Tamper Tape", "No Seal"];

// NOTE: parcel-level statuses now render with the SAME full status list as the
// manifest (MANIFEST_STATUSES below) via <ManifestStatusBadge />, so the old
// 8-value statusColors map (which didn't know about flight/customs/etc. statuses)
// has been removed to avoid the two lists drifting out of sync again.

export const MANIFEST_STATUSES = [
  { value: "created",             label: "Created",              icon: "🆕", tw: "bg-amber-400 text-white border-amber-500",       dot: "bg-amber-300"   },
  { value: "picked_up",           label: "Picked Up",            icon: "📦", tw: "bg-violet-500 text-white border-violet-600",     dot: "bg-violet-400"  },
  { value: "in_transit",          label: "In Transit",           icon: "✈️",  tw: "bg-blue-600 text-white border-blue-700",         dot: "bg-blue-400"    },
  { value: "flight_departure",    label: "Flight Departure",     icon: "🛫", tw: "bg-indigo-600 text-white border-indigo-700",     dot: "bg-indigo-400"  },
  { value: "flight_arrived",      label: "Flight Arrived",       icon: "🛬", tw: "bg-teal-600 text-white border-teal-700",         dot: "bg-teal-400"    },
  { value: "flight_offload",      label: "Flight Offload",       icon: "📤", tw: "bg-cyan-600 text-white border-cyan-700",         dot: "bg-cyan-400"    },
  { value: "arrived_hub",         label: "Arrived Hub",          icon: "🏢", tw: "bg-sky-600 text-white border-sky-700",           dot: "bg-sky-400"     },
  { value: "customs",             label: "In Customs",           icon: "🛃", tw: "bg-orange-600 text-white border-orange-700",     dot: "bg-orange-400"  },
  { value: "in_custom_clearance", label: "In Custom Clearance",  icon: "🧾", tw: "bg-yellow-500 text-white border-yellow-600",     dot: "bg-yellow-400"  },
  { value: "custom_hold",         label: "Custom Hold",          icon: "🛑", tw: "bg-rose-600 text-white border-rose-700",         dot: "bg-rose-400"    },
  { value: "out_for_delivery",    label: "Out for Delivery",     icon: "🚚", tw: "bg-pink-600 text-white border-pink-700",         dot: "bg-pink-400"    },
  { value: "delivered",           label: "Delivered",            icon: "✅", tw: "bg-green-600 text-white border-green-700",       dot: "bg-green-400"   },
  { value: "returned",            label: "Returned",             icon: "↩️",  tw: "bg-red-500 text-white border-red-600",           dot: "bg-red-400"     },
  { value: "cancelled",           label: "Cancelled",            icon: "❌", tw: "bg-slate-600 text-white border-slate-700",       dot: "bg-slate-400"   },
] as const;

// ── Sample CSV template columns ───────────────────────────────────────────────
const CSV_SAMPLE_HEADERS = [
  "tracking_id", "hawb_no", "sender_name", "sender_phone", "sender_city", "sender_country",
  "receiver_name", "receiver_phone", "receiver_address", "receiver_city",
  "receiver_postal_code", "receiver_country", "weight", "pieces", "value",
  "currency", "service_type", "parcel_type", "description",
];
const CSV_SAMPLE_ROW = [
  "TRK123456789", "HAWB001", "John Smith", "+923001234567", "Lahore", "PK",
  "Jane Doe", "+447911123456", "10 Baker Street", "London",
  "W1U 3FB", "GB", "2.5", "1", "150.00",
  "GBP", "Express", "Documents", "Personal documents",
];

// ── Helpers ────────────────────────────────────────────────────────────────────
function downloadSampleCSV() {
  const rows = [CSV_SAMPLE_HEADERS, CSV_SAMPLE_ROW];
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "SkyXpress_Import_Sample.csv"; a.click();
  URL.revokeObjectURL(url);
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = ""; let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (ch === "," && !inQuote) { result.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  result.push(cur.trim());
  return result;
}

function csvToParcel(row: string[], headers: string[]): any {
  const map: Record<string, string> = {};
  headers.forEach((h, i) => { map[h.trim().toLowerCase()] = row[i] || ""; });
  return {
    id:                   crypto.randomUUID(),
    tracking_id:          map.tracking_id || map.hawb_no || `IMP-${Date.now()}`,
    reference_id:         map.hawb_no || "",
    sender_name:          map.sender_name || "",
    sender_phone:         map.sender_phone || "",
    sender_city:          map.sender_city || "",
    sender_country:       map.sender_country || "",
    receiver_name:        map.receiver_name || "",
    receiver_phone:       map.receiver_phone || "",
    receiver_address:     map.receiver_address || "",
    receiver_city:        map.receiver_city || "",
    receiver_postal_code: map.receiver_postal_code || "",
    receiver_country:     map.receiver_country || "",
    from_country:         map.sender_country || "",
    to_country:           map.receiver_country || "",
    weight:               parseFloat(map.weight) || 0,
    pieces:               parseInt(map.pieces) || 1,
    total_price:          parseFloat(map.value) || 0,
    currency:             map.currency || "USD",
    service_type:         map.service_type || "Standard",
    parcel_type:          map.parcel_type || "Parcel",
    current_status:       "processing",
    created_at:           new Date().toISOString(),
    items:                map.description ? [{ description: map.description, quantity: 1, unit_price: parseFloat(map.value) || 0 }] : [],
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ManifestStatusBadge({ status, size = "sm" }: { status?: string; size?: "sm" | "xs" }) {
  if (!status) return <span className="text-slate-300 text-xs">—</span>;
  const s = MANIFEST_STATUSES.find((x) => x.value === status);
  if (!s) return <span className="text-xs text-slate-500 capitalize">{status.replace(/_/g, " ")}</span>;
  const base = size === "xs"
    ? "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border tracking-wide"
    : "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold border tracking-wide";
  return (
    <span className={`${base} ${s.tw}`}>
      <span className="text-[11px] leading-none">{s.icon}</span>
      {s.label}
    </span>
  );
}

// Searchable combobox — replaces plain <Select> for hubs
function SearchableSelect({
  value, onChange, options, placeholder, disabled, className = "",
}: {
  value: string; onChange: (v: string) => void; options: string[];
  placeholder?: string; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const filtered = query.length > 0
    ? options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled}
          className={`flex h-8 w-full items-center justify-between rounded border border-slate-200 bg-white px-2 text-sm text-left focus:outline-none focus:border-blue-400 disabled:opacity-50 disabled:cursor-not-allowed ${className}`}
        >
          <span className={value ? "text-slate-800 truncate" : "text-slate-400"}>
            {value || placeholder || "Select…"}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400 flex-shrink-0 ml-1" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 z-[9999]" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search…"
            value={query}
            onValueChange={setQuery}
            className="h-8 text-sm"
          />
          <CommandList className="max-h-60">
            {filtered.length === 0 && <CommandEmpty>No results found.</CommandEmpty>}
            <CommandGroup>
              {filtered.map((opt) => (
                <CommandItem
                  key={opt}
                  value={opt}
                  onSelect={() => { onChange(opt); setOpen(false); setQuery(""); }}
                  className="text-xs cursor-pointer"
                >
                  <Check className={`h-3.5 w-3.5 mr-2 flex-shrink-0 ${value === opt ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                  {opt}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// Editable combobox — can type a custom value OR pick from list (for License)
function EditableCombobox({
  value, onChange, options, placeholder, disabled, className = "",
}: {
  value: string; onChange: (v: string) => void; options: string[];
  placeholder?: string; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputVal, setInputVal] = useState(value || "");
  const filtered = inputVal.length > 0
    ? options.filter((o) => o.toLowerCase().includes(inputVal.toLowerCase()))
    : options;

  useEffect(() => { setInputVal(value || ""); }, [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            value={inputVal}
            disabled={disabled}
            placeholder={placeholder || "Type or select…"}
            className={`h-8 text-sm border-slate-200 pr-7 ${className}`}
            onChange={(e) => {
              setInputVal(e.target.value);
              onChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
          <button
            type="button"
            tabIndex={-1}
            disabled={disabled}
            onClick={() => setOpen((o) => !o)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <ChevronsUpDown className="h-3.5 w-3.5" />
          </button>
        </div>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0 z-[9999]" align="start">
        <Command shouldFilter={false}>
          <CommandList className="max-h-48">
            {filtered.length === 0 ? (
              <CommandEmpty className="py-3 text-xs text-slate-500">
                Press Enter or type to use "{inputVal}"
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {filtered.map((opt) => (
                  <CommandItem
                    key={opt}
                    value={opt}
                    onSelect={() => { onChange(opt); setInputVal(opt); setOpen(false); }}
                    className="text-xs cursor-pointer"
                  >
                    <Check className={`h-3.5 w-3.5 mr-2 flex-shrink-0 ${value === opt ? "opacity-100 text-blue-600" : "opacity-0"}`} />
                    {opt}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function Field({
  label, value, onChange, type = "text", placeholder, disabled = false,
  className = "", readOnly = false,
}: {
  label: string; value: string | number | undefined; onChange?: (v: string) => void;
  type?: string; placeholder?: string; disabled?: boolean; className?: string; readOnly?: boolean;
}) {
  return (
    <div className={`space-y-1 ${className}`}>
      <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider leading-none">
        {label}
      </Label>
      {readOnly || disabled ? (
        <div className="h-8 px-2 flex items-center text-sm bg-slate-50 border border-slate-200 rounded text-slate-700 font-medium truncate">
          {value || <span className="text-slate-400">—</span>}
        </div>
      ) : (
        <Input
          type={type} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder || label}
          className="h-8 text-sm border-slate-200 focus:border-blue-400 bg-white"
        />
      )}
    </div>
  );
}

// ── Bagging Dialog ─────────────────────────────────────────────────────────────
function BaggingDialog({ open, onClose, onSave, initialData, disabled }: {
  open: boolean; onClose: () => void;
  onSave: (data: any) => void;
  initialData?: any; disabled?: boolean;
}) {
  const [bags, setBags] = useState<any[]>(
    initialData?.bags?.length > 0 ? initialData.bags : [
      { bagType: "Standard Bag", bagSize: "Medium (M)", quantity: 1, sealType: "Plastic Seal", sealNumber: "", notes: "" },
    ]
  );

  const addBag = () => setBags((b) => [...b, { bagType: "Standard Bag", bagSize: "Medium (M)", quantity: 1, sealType: "Plastic Seal", sealNumber: "", notes: "" }]);
  const removeBag = (i: number) => setBags((b) => b.filter((_, idx) => idx !== i));
  const updateBag = (i: number, key: string, val: any) =>
    setBags((b) => b.map((item, idx) => idx === i ? { ...item, [key]: val } : item));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Box className="h-5 w-5 text-blue-600" />
            Bagging / Boxing Details
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-3 pr-1">
          {bags.map((bag, i) => (
            <div key={i} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-600 uppercase tracking-wider">Bag / Box #{i + 1}</span>
                {bags.length > 1 && !disabled && (
                  <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                    onClick={() => removeBag(i)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Bag / Box Type</Label>
                  <Select value={bag.bagType} onValueChange={(v) => updateBag(i, "bagType", v)} disabled={disabled}>
                    <SelectTrigger className="h-8 text-sm border-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BAG_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Size</Label>
                  <Select value={bag.bagSize} onValueChange={(v) => updateBag(i, "bagSize", v)} disabled={disabled}>
                    <SelectTrigger className="h-8 text-sm border-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BAG_SIZES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Qty</Label>
                  <Input type="number" min={1} value={bag.quantity} disabled={disabled}
                    className="h-8 text-sm border-slate-200"
                    onChange={(e) => updateBag(i, "quantity", parseInt(e.target.value) || 1)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Seal Type</Label>
                  <Select value={bag.sealType} onValueChange={(v) => updateBag(i, "sealType", v)} disabled={disabled}>
                    <SelectTrigger className="h-8 text-sm border-slate-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SEAL_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Seal Number</Label>
                  <Input value={bag.sealNumber} disabled={disabled} placeholder="e.g. SL-00123"
                    className="h-8 text-sm border-slate-200"
                    onChange={(e) => updateBag(i, "sealNumber", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Notes</Label>
                  <Input value={bag.notes} disabled={disabled} placeholder="Optional notes"
                    className="h-8 text-sm border-slate-200"
                    onChange={(e) => updateBag(i, "notes", e.target.value)} />
                </div>
              </div>
            </div>
          ))}
          {!disabled && (
            <Button variant="outline" size="sm" className="w-full border-dashed border-slate-300 text-slate-500 gap-2"
              onClick={addBag}>
              <Plus className="h-3.5 w-3.5" /> Add Another Bag / Box
            </Button>
          )}
        </div>
        {/* Summary */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-2 flex items-center gap-4">
          <Box className="h-4 w-4 text-blue-600" />
          <div className="flex gap-6 text-xs">
            <span><span className="font-bold text-slate-700">{bags.length}</span> <span className="text-slate-500">types</span></span>
            <span><span className="font-bold text-slate-700">{bags.reduce((s, b) => s + (b.quantity || 0), 0)}</span> <span className="text-slate-500">total bags</span></span>
          </div>
        </div>
        <div className="flex gap-3 justify-end pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          {!disabled && (
            <Button size="sm" className="bg-blue-700 hover:bg-blue-800 text-white gap-1.5"
              onClick={() => { onSave({ bags }); onClose(); }}>
              <CheckCircle2 className="h-3.5 w-3.5" /> Save Bagging Info
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Manifest History Dialog ────────────────────────────────────────────────────
function ManifestHistoryDialog({ open, onClose, manifestId }: {
  open: boolean; onClose: () => void; manifestId: string;
}) {
  const [history, setHistory] = useState<ManifestHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !manifestId) return;
    setLoading(true);
    loadManifestHistory(manifestId).then((h) => { setHistory(h); setLoading(false); });
  }, [open, manifestId]);

  const FIELD_LABELS: Record<string, string> = {
    manifestStatus: "Status", isLocked: "Locked", flightNo: "Flight No",
    originHub: "Origin Hub", destinationHub: "Destination Hub",
    service: "Service", forwarder: "Forwarder", license: "License",
    manifestDate: "Date", runNumber: "Run No", noOfBags: "Bags",
    vendorWeight: "Vendor Wt", arrivalDate: "Arrival Date",
    bookingFromDate: "Booking From", bookingTillDate: "Booking Till",
    masterNo: "Master No", remark: "Remark", company: "Company",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="h-5 w-5 text-blue-600" />
            Manifest History
            <Badge className="bg-blue-100 text-blue-700 text-xs">{manifestId}</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-3">
          {loading ? (
            <div className="py-16 text-center">
              <RefreshCw className="h-6 w-6 animate-spin text-slate-300 mx-auto mb-2" />
              <p className="text-sm text-slate-500">Loading history…</p>
            </div>
          ) : history.length === 0 ? (
            <div className="py-16 text-center">
              <History className="h-10 w-10 text-slate-200 mx-auto mb-3" />
              <p className="font-semibold text-slate-500">No history yet</p>
              <p className="text-xs text-slate-400 mt-1">History is recorded each time you save a manifest.</p>
            </div>
          ) : (
            history.map((entry, idx) => {
              const snap = entry.snapshot || {};
              const changedFields = Object.keys(snap).filter((k) => k !== "parcels" && k !== "trackingIds" && k !== "trackingEvents");
              return (
                <div key={entry.id} className="bg-white border border-slate-100 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-gradient-to-r from-slate-800 to-blue-900 px-4 py-2.5 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="bg-orange-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                        #{history.length - idx}
                      </div>
                      <div>
                        <p className="text-white text-xs font-semibold">
                          {new Date(entry.changedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                          {" "}
                          {new Date(entry.changedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                        <p className="text-blue-300 text-[10px]">by {entry.changedBy}</p>
                      </div>
                    </div>
                    {entry.changeNote && (
                      <span className="text-blue-200 text-[10px] italic">{entry.changeNote}</span>
                    )}
                  </div>
                  <div className="p-3">
                    {changedFields.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">Parcels / tracking updated</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {changedFields.map((k) => (
                          <div key={k} className="bg-slate-50 border border-slate-100 rounded px-2 py-1">
                            <p className="text-[9px] text-slate-400 uppercase font-bold">{FIELD_LABELS[k] || k}</p>
                            <p className="text-xs text-slate-700 font-medium">
                              {k === "isLocked" ? (snap[k] ? "Locked" : "Unlocked") : String(snap[k] ?? "—")}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="flex justify-end pt-1">
          <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────
export const ManifestStock = ({ filterUserId, filterEmail }: { filterUserId?: string; filterEmail?: string } = {}) => {
  // isAdminView = no partner scope applied → admin is viewing all manifests
  const isAdminView = !filterUserId && !filterEmail;

  const [entries, setEntries]         = useState<ManifestStockEntry[]>([]);
  const [search, setSearch]           = useState("");
  const [selected, setSelected]       = useState<ManifestStockEntry | null>(null);
  const [editing, setEditing]         = useState<ManifestStockEntry | null>(null);
  const [countryMap, setCountryMap]   = useState<Record<string, string>>({});
  const [downloading, setDownloading] = useState<string | null>(null);
  const [saving, setSaving]           = useState(false);
  const [awbSearch, setAwbSearch]     = useState("");
  const [csvFile, setCsvFile]         = useState<File | null>(null);
  const [importing, setImporting]     = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus]   = useState<string>("");
  const [bulkComment, setBulkComment] = useState<string>("");
  const [showBulkDialog, setShowBulkDialog]   = useState(false);
  const [showBagging, setShowBagging]         = useState(false);
  const [showHistory, setShowHistory]         = useState(false);
  const [currentUser, setCurrentUser]         = useState<{ email: string; name: string } | null>(null);
  // ROLE: resolved from profiles for the logged-in user — drives permission gating
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [licenses, setLicenses]               = useState<string[]>([]);
  const [addingLicense, setAddingLicense]     = useState(false);
  const [newLicenseCode, setNewLicenseCode]   = useState("");
  const [savingLicense, setSavingLicense]     = useState(false);
  // Admin-only: filter manifests by a specific partner
  const [partnerFilter, setPartnerFilter]     = useState<string>("all");
  const [partners, setPartners]               = useState<Array<{ id: string; email: string; name: string }>>([]);
  // Lookup map: user_id → { username, branch } from public.partner_profiles
  const [partnerProfileMap, setPartnerProfileMap] = useState<Record<string, { username: string; branch: string }>>({});
  // ── Parcel reference-ID search (add to open manifest, or spin up a new one) ──
  const [parcelSearchQuery, setParcelSearchQuery]     = useState("");
  const [parcelSearchResults, setParcelSearchResults] = useState<any[]>([]);
  const [searchingParcels, setSearchingParcels]       = useState(false);
  const [showFindParcelDialog, setShowFindParcelDialog] = useState(false);
  const [findParcelQuery, setFindParcelQuery]         = useState("");
  const [findParcelResults, setFindParcelResults]     = useState<any[]>([]);
  const [findingParcel, setFindingParcel]             = useState(false);
  const [creatingManifestFor, setCreatingManifestFor] = useState<string | null>(null);
  // ── Status update dialog (single row / detail panel) — asks for a comment ──
  const [singleStatusDialog, setSingleStatusDialog] = useState<{ open: boolean; manifestId: string; status: string; comment: string }>({
    open: false, manifestId: "", status: "", comment: "",
  });

  // ── Multi-parcel "Create Manifest" workflow ──────────────────────────────
  // Step 1: add one or more parcels by Reference ID / Tracking ID
  // Step 2: fill in manifest-level fields (origin/dest hub, flight, service…)
  // Step 3: generate the manifest and open it for editing
  const [showCreateManifestDialog, setShowCreateManifestDialog] = useState(false);
  const [refIdInput, setRefIdInput]                     = useState("");
  const [pendingParcels, setPendingParcels]             = useState<any[]>([]);
  const [searchingPending, setSearchingPending]         = useState(false);
  const [showManifestFieldsDialog, setShowManifestFieldsDialog] = useState(false);
  const [generating, setGenerating]                     = useState(false);
  // Manifest draft fields captured in Step 2 — kept as a Partial so any field
  // the user skips just falls back to the per-parcel value or the default.
  const [manifestDraft, setManifestDraft] = useState<Record<string, any>>({
    bookingFromDate: "",
    bookingTillDate: "",
    forwarder: "",
    service: "",
    masterNo: "",
    masterEdiBagNo: "",
    remark: "",
    manifestDate: "",
    manifestTime: "",
    runNumber: "",
    flightNo: "",
    noOfBags: "",
    arrivalDate: "",
    arrivalTime: "",
    company: "",
    license: "",
    vendorWeight: "",
    totalVolumetricWt: "",
    originHub: "",
    destinationHub: "",
  });

  const csvInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  // ── Auth user ──────────────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data?.session?.user;
      if (u) {
        const name = u.user_metadata?.full_name || u.user_metadata?.name || u.email?.split("@")[0] || "Admin";
        setCurrentUser({ email: u.email || "", name });
        // ROLE GATE support: resolve the logged-in user's role from profiles
        const { data: prof } = await supabase.from("profiles").select("role").eq("user_id", u.id).single();
        setCurrentUserRole(prof?.role ?? null);
      }
    });
  }, []);

  // ── ROLE-BASED PERMISSIONS (enforced by logged-in role) ────────────────────
  // Partner scope   = this component renders one partner's own manifests
  //                   (PartnerDashboard passes filterUserId / filterEmail).
  // Restricted role = any role that is not admin / staff (partner, user, …).
  // Partners can VIEW the manifest list, download Excel/PDF and set status,
  // but CANNOT open the manifest editor (no editing) and CANNOT delete.
  const isPartnerScope   = !!(filterUserId || filterEmail);
  const isRestrictedRole = !!currentUserRole && currentUserRole !== "admin" && currentUserRole !== "staff";
  const canEditManifest   = !isPartnerScope && !isRestrictedRole; // open / edit manifest
  const canDeleteManifest = currentUserRole === "admin";          // ONLY admin can delete manifests

  const reload = useCallback(async () => {
    const data = await loadManifestStockDB();
    setEntries(data);
  }, []);

  useEffect(() => {
    reload();
    fetchLicenses().then(setLicenses);
    supabase.from("countries").select("code, name").then(({ data }) => {
      if (data) {
        const map: Record<string, string> = {};
        data.forEach((c: any) => { map[c.code] = c.name; });
        setCountryMap(map);
      }
    });
  }, [reload]);

  // Fetch partner_profiles (username, branch) — builds the lookup map used by the
  // "Branch / Made By" column, and (for admins) the partner-filter dropdown list.
  useEffect(() => {
    (async () => {
      try {
        const { data: partnerData, error } = await supabase
          .from("partner_profiles")
          .select("user_id, username, branch")
          .eq("status", "active");

        if (error) {
          console.warn("[ManifestStock] failed to fetch partner_profiles:", error.message);
          return;
        }
        if (!partnerData || partnerData.length === 0) return;

        const map: Record<string, { username: string; branch: string }> = {};
        partnerData.forEach((p: any) => {
          map[p.user_id] = { username: p.username || "", branch: p.branch || "" };
        });
        setPartnerProfileMap(map);

        if (isAdminView) {
          setPartners(
            partnerData.map((p: any) => ({
              id:    p.user_id,
              email: "",
              // Display priority: username → branch → shortened UID
              name:  p.username || p.branch || `Partner …${(p.user_id as string).slice(-6)}`,
            }))
          );
        }
      } catch (err) {
        console.warn("[ManifestStock] partner_profiles fetch error:", err);
      }
    })();
  }, [isAdminView]);

  const openDetail = (entry: ManifestStockEntry, opts?: { force?: boolean }) => {
    // ROLE GATE: partners / restricted roles cannot open or edit manifests.
    // The create-manifest flows call this with { force: true } so a freshly
    // generated manifest can still be filled in once by its creator.
    if (!opts?.force && !canEditManifest) {
      toast({ title: "Not allowed", description: "Your role cannot edit manifests.", variant: "destructive" });
      return;
    }
    setSelected(entry);
    setEditing({
      ...entry,
      // Auto-fill createdByUser if empty
      createdByUser: entry.createdByUser || currentUser?.name || "",
    });
  };

  const closeDetail = () => {
    setSelected(null);
    setEditing(null);
    setAwbSearch("");
    setCsvFile(null);
    setParcelSearchQuery("");
    setParcelSearchResults([]);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      const userLabel = currentUser?.email || currentUser?.name || "admin";
      await updateManifestInStockDB(editing.manifestId, editing);

      // FIX: push the manifest's "Tracking Events" tab down to the parcels
      // table's status_timeline so the public tracking page picks them up.
      // Without this, events staff add in the editor are saved only on the
      // manifest record and never appear on the customer-facing tracking page.
      await syncTrackingEventsToParcels(editing);

      // Save history snapshot (without parcels to keep it lightweight)
      const { parcels: _, trackingIds: __, ...snap } = editing;
      await saveManifestHistory(editing.manifestId, snap, userLabel);
      await reload();
      setSelected(editing);
      toast({
        title: "Manifest updated ✓",
        description: `Manifest ${editing.manifestId} saved${
          (editing.trackingEvents?.length || 0) > 0
            ? ` · ${editing.trackingEvents.length} tracking event(s) synced to parcels`
            : ""
        }.`,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleClone = async () => {
    if (!editing) return;
    const clone: ManifestStockEntry = {
      ...editing,
      manifestId: editing.manifestId + "-COPY",
      createdAt: new Date().toISOString(),
      isLocked: false,
    };
    await saveManifestToStockDB(clone);
    await reload();
    toast({ title: "Cloned", description: `Created ${clone.manifestId}` });
    closeDetail();
  };

  const handleLockToggle = async () => {
    if (!editing) return;
    const locked = !editing.isLocked;
    setEditing((e) => e ? { ...e, isLocked: locked } : e);
    await updateManifestInStockDB(editing.manifestId, { isLocked: locked });
    await reload();
    toast({ title: locked ? "Manifest locked 🔒" : "Manifest unlocked 🔓" });
  };

  const handleDelete = async (manifestId: string) => {
    // ROLE GATE: only admins can delete manifests.
    if (!canDeleteManifest) {
      toast({ title: "Not allowed", description: "Only admins can delete manifests.", variant: "destructive" });
      return;
    }
    if (!window.confirm(`Delete manifest ${manifestId}? This cannot be undone.`)) return;
    await deleteManifestFromStockDB(manifestId);
    await reload();
    if (selected?.manifestId === manifestId) closeDetail();
    toast({ title: "Manifest deleted", description: manifestId });
  };

  const handleExcelDownload = async (entry: ManifestStockEntry) => {
    setDownloading(entry.manifestId + "-xls");
    try {
      exportManifestToExcel(entry.parcels as any, countryMap, `SkyXpress_Manifest_${entry.manifestId}.xlsx`, entry.manifestId);
      toast({ title: "Excel downloaded ✓", description: entry.manifestId });
    } catch (e: any) {
      toast({ title: "Export failed", description: e.message, variant: "destructive" });
    } finally { setDownloading(null); }
  };

  const handlePDFDownload = async (entry: ManifestStockEntry) => {
    setDownloading(entry.manifestId + "-pdf");
    try {
      await generateBulkManifestPDF(entry, countryMap);
      toast({ title: "PDF downloaded ✓", description: entry.manifestId });
    } catch (e: any) {
      toast({ title: "PDF failed", description: e.message, variant: "destructive" });
    } finally { setDownloading(null); }
  };


  const setEditField = (key: keyof ManifestStockEntry, val: any) =>
    setEditing((e) => e ? { ...e, [key]: val } : e);

  // ── CSV Import ──────────────────────────────────────────────────────────────
  const handleCSVImport = async () => {
    if (!csvFile || !editing) return;
    setImporting(true);
    try {
      const text = await csvFile.text();
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length < 2) {
        toast({ title: "CSV error", description: "File must have a header row + at least one data row.", variant: "destructive" });
        return;
      }
      const headers = parseCSVLine(lines[0]);
      const newParcels = lines.slice(1).map((line) => csvToParcel(parseCSVLine(line), headers));
      const merged = [...editing.parcels, ...newParcels];
      const updatedEntry = {
        ...editing,
        parcels: merged,
        parcelCount: merged.length,
        trackingIds: merged.map((p) => p.tracking_id),
        totalWeight: Math.round(merged.reduce((s, p) => s + Number(p.weight || 0), 0) * 100) / 100,
        totalValue: Math.round(merged.reduce((s, p) => s + Number(p.total_price || 0), 0) * 100) / 100,
      };
      setEditing(updatedEntry);
      setCsvFile(null);
      if (csvInputRef.current) csvInputRef.current.value = "";
      toast({ title: `Imported ${newParcels.length} AWB${newParcels.length !== 1 ? "s" : ""} ✓`, description: "Click Update Manifest to save." });
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  // ── Parcel Reference-ID Search (inside an open manifest) ─────────────────────
  // Looks a parcel up by reference_id OR tracking_id in the shared `parcels`
  // table and lets you drop it straight into the manifest that's currently open.
  const handleParcelSearch = async () => {
    const q = parcelSearchQuery.trim();
    if (!q) return;
    setSearchingParcels(true);
    try {
      const { data, error } = await supabase
        .from("parcels")
        .select("*")
        .or(`reference_id.ilike.%${q}%,tracking_id.ilike.%${q}%`)
        .limit(15);
      if (error) throw error;
      setParcelSearchResults(data || []);
      if (!data || data.length === 0) {
        toast({ title: "No parcels found", description: `Nothing matched "${q}"` });
      }
    } catch (e: any) {
      toast({ title: "Search failed", description: e.message, variant: "destructive" });
    } finally {
      setSearchingParcels(false);
    }
  };

  const handleAddParcelToManifest = (parcel: any) => {
    if (!editing) return;
    const already = editing.parcels.some((p) => p.tracking_id === parcel.tracking_id);
    if (already) {
      toast({ title: "Already in this manifest", description: parcel.tracking_id, variant: "destructive" });
      return;
    }
    const merged = [...editing.parcels, parcel];
    setEditing({
      ...editing,
      parcels: merged,
      parcelCount: merged.length,
      trackingIds: merged.map((p) => p.tracking_id),
      totalWeight: Math.round(merged.reduce((s, p) => s + Number(p.weight || 0), 0) * 100) / 100,
      totalValue: Math.round(merged.reduce((s, p) => s + Number(p.total_price ?? p.value ?? 0), 0) * 100) / 100,
    });
    setParcelSearchResults((r) => r.filter((p) => (p.id || p.tracking_id) !== (parcel.id || parcel.tracking_id)));
    toast({ title: "Parcel added ✓", description: `${parcel.tracking_id} added. Click Update Manifest to save.` });
  };

  // ── Find Parcel → Create New Manifest (when nothing is open yet) ─────────────
  const handleFindParcelSearch = async () => {
    const q = findParcelQuery.trim();
    if (!q) return;
    setFindingParcel(true);
    try {
      const { data, error } = await supabase
        .from("parcels")
        .select("*")
        .or(`reference_id.ilike.%${q}%,tracking_id.ilike.%${q}%`)
        .limit(15);
      if (error) throw error;
      setFindParcelResults(data || []);
      if (!data || data.length === 0) {
        toast({ title: "No parcels found", description: `Nothing matched "${q}"` });
      }
    } catch (e: any) {
      toast({ title: "Search failed", description: e.message, variant: "destructive" });
    } finally {
      setFindingParcel(false);
    }
  };

  const handleCreateManifestFromParcel = async (parcel: any) => {
    setCreatingManifestFor(parcel.id || parcel.tracking_id);
    try {
      const manifestId = `SXM-${Date.now().toString().slice(-9)}`;
      const newEntry: any = {
        manifestId,
        createdAt: new Date().toISOString(),
        parcels: [parcel],
        parcelCount: 1,
        trackingIds: [parcel.tracking_id],
        totalWeight: Number(parcel.weight) || 0,
        totalValue: Number(parcel.total_price ?? parcel.value ?? 0) || 0,
        currency: parcel.currency || "USD",
        serviceType: parcel.service_type || "Standard",
        fromCountry: parcel.from_country || "",
        toCountry: parcel.to_country || "",
        isLocked: false,
        createdByUser: currentUser?.email || currentUser?.name || "",
      };
      await saveManifestToStockDB(newEntry);
      await reload();
      setShowFindParcelDialog(false);
      setFindParcelResults([]);
      setFindParcelQuery("");
      toast({ title: "Manifest created ✓", description: `${manifestId} · ${parcel.tracking_id}` });
      // force: the creator may fill in the manifest they just created once
      openDetail(newEntry, { force: true });
    } catch (e: any) {
      toast({ title: "Failed to create manifest", description: e.message, variant: "destructive" });
    } finally {
      setCreatingManifestFor(null);
    }
  };

  // ── Multi-parcel Create Manifest workflow ───────────────────────────────
  // Step 1 — add a parcel (or several) to the pending list using a Reference
  // ID / Tracking ID lookup. Multiple parcels can be queued before generating.
  const handleAddPendingParcel = async () => {
    const q = refIdInput.trim();
    if (!q) return;
    setSearchingPending(true);
    try {
      const { data, error } = await supabase
        .from("parcels")
        .select("*")
        .or(`reference_id.ilike.%${q}%,tracking_id.ilike.%${q}%`)
        .limit(20);
      if (error) throw error;
      if (!data || data.length === 0) {
        toast({ title: "No parcels found", description: `Nothing matched "${q}"` });
        return;
      }
      // De-dupe against what's already queued
      const existingIds = new Set(pendingParcels.map((p) => p.tracking_id));
      const additions = data.filter((p) => !existingIds.has(p.tracking_id));
      if (additions.length === 0) {
        toast({ title: "Already added", description: "All matched parcels are already in the list." });
        return;
      }
      setPendingParcels((prev) => [...prev, ...additions]);
      setRefIdInput("");
      toast({
        title: `${additions.length} parcel${additions.length > 1 ? "s" : ""} added ✓`,
        description: "Add another, or click Generate Manifest to continue.",
      });
    } catch (e: any) {
      toast({ title: "Search failed", description: e.message, variant: "destructive" });
    } finally {
      setSearchingPending(false);
    }
  };

  const removePendingParcel = (trackingId: string) =>
    setPendingParcels((prev) => prev.filter((p) => p.tracking_id !== trackingId));

  const resetCreateManifest = () => {
    setShowCreateManifestDialog(false);
    setShowManifestFieldsDialog(false);
    setPendingParcels([]);
    setRefIdInput("");
    setManifestDraft({
      bookingFromDate: "", bookingTillDate: "", forwarder: "", service: "",
      masterNo: "", masterEdiBagNo: "", remark: "", manifestDate: "", manifestTime: "",
      runNumber: "", flightNo: "", noOfBags: "", arrivalDate: "", arrivalTime: "",
      company: "", license: "", vendorWeight: "", totalVolumetricWt: "",
      originHub: "", destinationHub: "",
    });
  };

  // Step 3 — generate the manifest using the queued parcels + filled draft
  const handleGenerateManifest = async () => {
    if (pendingParcels.length === 0) {
      toast({ title: "No parcels", description: "Add at least one parcel first.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const manifestId = `SXM-${Date.now().toString().slice(-9)}`;
      // Only keep non-empty draft values so per-parcel defaults take over for
      // any field the user left blank.
      const cleanDraft: Record<string, any> = {};
      Object.entries(manifestDraft).forEach(([k, v]) => {
        if (v !== "" && v !== null && v !== undefined) cleanDraft[k] = v;
      });

      const newEntry: any = {
        manifestId,
        createdAt: new Date().toISOString(),
        parcels: pendingParcels,
        parcelCount: pendingParcels.length,
        trackingIds: pendingParcels.map((p) => p.tracking_id),
        totalWeight: Math.round(pendingParcels.reduce((s, p) => s + Number(p.weight || 0), 0) * 100) / 100,
        totalValue: Math.round(pendingParcels.reduce((s, p) => s + Number(p.total_price ?? p.value ?? 0), 0) * 100) / 100,
        currency: pendingParcels[0]?.currency || "USD",
        serviceType: cleanDraft.service || pendingParcels[0]?.service_type || "Standard",
        fromCountry: pendingParcels[0]?.from_country || "",
        toCountry: pendingParcels[0]?.to_country || "",
        isLocked: false,
        createdByUser: currentUser?.email || currentUser?.name || "",
        manifestStatus: "created",
        ...cleanDraft,
      };
      await saveManifestToStockDB(newEntry);
      await reload();

      const count = pendingParcels.length;
      resetCreateManifest();
      toast({
        title: "Manifest created ✓",
        description: `${manifestId} · ${count} parcel${count > 1 ? "s" : ""}`,
      });
      // force: the creator may fill in the manifest they just created once
      openDetail(newEntry, { force: true });
    } catch (e: any) {
      toast({ title: "Failed to create manifest", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  // ── Selection helpers ──────────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const toggleSelectAll = () =>
    setSelectedIds((prev) => prev.size === filtered.length ? new Set() : new Set(filtered.map((e) => e.manifestId)));

  // ── Cascade a status change (with an optional comment) down to every parcel
  // inside a manifest. Keeps things in sync in three places:
  //   1. The manifest record itself (manifestStatus)
  //   2. Each parcel embedded in that manifest's `parcels` array (current_status)
  //   3. The standalone `parcels` table in Supabase — including appending a
  //      timeline event (status + comment) to `status_timeline`, which is what
  //      the public tracking page reads and displays to the customer.
  //
  // FIX: we now ALSO mirror the comment into `admin_note` on the parcels row
  // so the stylish "Note from SkyXpress" callout at the top of the public
  // tracking page shows the most recent staff comment — not just the inline
  // note attached to the timeline dot.
  const cascadeStatusToParcels = async (manifestId: string, status: string, parcels: any[], comment?: string) => {
    const hasParcels = parcels && parcels.length > 0;
    const entry = entries.find((e) => e.manifestId === manifestId);
    const location = entry?.destinationHub || entry?.originHub || "";
    const nowIso = new Date().toISOString();
    const updatedParcels = hasParcels
      ? parcels.map((p) => ({ ...p, current_status: status, status_comment: comment || p.status_comment }))
      : parcels;

    // 1+2. Persist the manifest status, and (if we have them) the parcels with new current_status
    await updateManifestInStockDB(
      manifestId,
      hasParcels ? { manifestStatus: status, parcels: updatedParcels } : { manifestStatus: status }
    );

    // 3. Push the same status + a timeline event (with the optional comment) into
    //    the shared `parcels` table (Parcel Management + Public Tracking backend).
    //    Also mirror the comment into `admin_note` so the public tracking page's
    //    top-of-pass "Note from SkyXpress" callout stays in sync with the latest
    //    staff comment.
    // FIX: this sync used to be "fire and forget" — every `.update()` call's
    // result was discarded, so a failed write (RLS policy blocking it, a bad
    // column, a permissions error) was invisible. The manifest editor would
    // still tell staff "Status updated ✓ (parcels synced)" even when NOTHING
    // was actually written to the `parcels` table, which is why a status
    // change from the manifest could appear to succeed here while the public
    // tracking page kept showing the old status. We now track per-row
    // success/failure and unmatched tracking IDs, and return that so the
    // caller can show an accurate result instead of a false-positive toast.
    const syncErrors: { trackingId: string; message: string }[] = [];
    const missingTrackingIds: string[] = [];
    let schemaFallback = false;

    if (hasParcels) {
      const trackingIds = updatedParcels.map((p) => p.tracking_id).filter(Boolean);
      if (trackingIds.length > 0) {
        try {
          const { data: rows, error: fetchErr } = await supabase
            .from("parcels")
            .select("id, tracking_id, status_timeline, detailed_status")
            .in("tracking_id", trackingIds);

          if (fetchErr) {
            console.warn("[ManifestStock] failed to fetch parcels for timeline update:", fetchErr.message);
            trackingIds.forEach((tid) => syncErrors.push({ trackingId: tid, message: fetchErr.message }));
          } else if (rows) {
            // Any tracking ID in the manifest that didn't come back from the
            // lookup never gets its status synced — flag it instead of
            // silently skipping it.
            const foundIds = new Set(rows.map((r: any) => r.tracking_id));
            trackingIds.forEach((tid) => {
              if (!foundIds.has(tid)) missingTrackingIds.push(tid);
            });

            const newEvent = { status, timestamp: nowIso, location, notes: comment || "" };
            await Promise.all(
              rows.map(async (r: any) => {
                const existing = Array.isArray(r.status_timeline) ? r.status_timeline : [];
                // Build the update payload. Always set current_status, updated_at,
                // and append the timeline event. Conditionally also push the
                // comment into admin_note/status_notes and the location into
                // current_location/last_location/detailed_status so any
                // tracking page (boarding pass OR PublicTracking.tsx) shows
                // the fresh values.
                const patch: Record<string, any> = {
                  current_status: status,
                  updated_at: nowIso,
                  status_timeline: [...existing, newEvent],
                };

                // Mirror the staff comment into `admin_note` + `status_notes`
                // so the public tracking page's prominent note callout stays
                // current. If no comment was supplied, leave the existing
                // admin_note untouched — we never blank it out from here.
                if (comment && comment.trim()) {
                  const c = comment.trim();
                  patch.admin_note = c;
                  patch.status_notes = c;
                }

                // Push the manifest's origin/destination hub into the
                // `current_location` / `last_location` / `detailed_status.location`
                // columns so tracking pages that read those (not just the
                // timeline) see the fresh location.
                if (location && String(location).trim()) {
                  const loc = String(location).trim();
                  patch.current_location = loc;
                  patch.last_location = loc;
                  const existingDetailed =
                    r.detailed_status && typeof r.detailed_status === "object" && !Array.isArray(r.detailed_status)
                      ? { ...r.detailed_status }
                      : {};
                  existingDetailed.location = loc;
                  if (comment && comment.trim()) {
                    existingDetailed.notes = comment.trim();
                  }
                  existingDetailed.updated_at = nowIso;
                  patch.detailed_status = existingDetailed;
                }

                // Resilient write: on a missing-column schema error this
                // retries with current_status/updated_at/status_timeline only,
                // so the parcel status ALWAYS syncs even if the database has
                // not been migrated yet (see supabase-parcels-status-sync.sql).
                const result = await updateParcelRowResilient(r.id, patch);
                if (!result.ok) {
                  console.warn(
                    `[ManifestStock] failed to sync parcel ${r.tracking_id}:`,
                    result.error
                  );
                  syncErrors.push({ trackingId: r.tracking_id, message: result.error || "unknown error" });
                } else if (result.schemaFallback) {
                  schemaFallback = true;
                }
              })
            );
          }
        } catch (err: any) {
          console.warn("[ManifestStock] parcels table sync error:", err);
          trackingIds.forEach((tid) => syncErrors.push({ trackingId: tid, message: String(err?.message || err) }));
        }
      }
    }

    return { updatedParcels, syncErrors, missingTrackingIds, schemaFallback };
  };

  // ── Sync the manifest's "Tracking Events" tab down to the parcels table.
  // This is the missing piece that previously left the public tracking page
  // blank when staff added per-AWB tracking events from the manifest editor.
  //
  // Each tracking event in `editing.trackingEvents` has the shape:
  //   { id, awb, event, location, timestamp, notes }
  // We map it onto a parcels.status_timeline entry of the shape:
  //   { status, timestamp, location, notes }
  // and append it to the matching parcel's timeline (deduped by timestamp+status
  // so re-saving the manifest doesn't duplicate entries). We also bump the
  // parcel's `current_status` to the latest event's status (most recent by
  // timestamp) so the boarding-pass status indicator on the public page
  // reflects what staff just entered.
  const syncTrackingEventsToParcels = async (manifestEntry: ManifestStockEntry) => {
    const events = (manifestEntry.trackingEvents || []).filter(
      (ev: any) => ev && ev.awb && (ev.event || ev.location || ev.notes)
    );
    if (events.length === 0) return;

    // Group events by AWB so we issue one update per parcel, with all of its
    // new events merged into a single deduped timeline.
    const byAwb: Record<string, any[]> = {};
    events.forEach((ev: any) => {
      const key = String(ev.awb).trim();
      if (!byAwb[key]) byAwb[key] = [];
      byAwb[key].push(ev);
    });

    const trackingIds = Object.keys(byAwb);
    if (trackingIds.length === 0) return;

    try {
      const { data: rows, error: fetchErr } = await supabase
        .from("parcels")
        .select("id, tracking_id, status_timeline, current_status, detailed_status")
        .in("tracking_id", trackingIds);

      if (fetchErr) {
        console.warn("[ManifestStock] failed to fetch parcels for tracking-event sync:", fetchErr.message);
        return;
      }
      if (!rows || rows.length === 0) return;

      await Promise.all(
        rows.map(async (r: any) => {
          const incoming = byAwb[r.tracking_id] || [];
          if (incoming.length === 0) return null;

          const existing = Array.isArray(r.status_timeline) ? r.status_timeline : [];

          // Dedupe key = `${timestamp}|${status}`. If the staff edited an
          // existing event in place (same timestamp), we still overwrite the
          // matching entry instead of appending a duplicate.
          const merged = [...existing];
          let latestEvent: any = null;

          incoming.forEach((ev: any) => {
            // Normalize timestamp: manifest stores local `datetime-local`
            // strings ("YYYY-MM-DDTHH:mm") — convert to ISO so the public
            // page's Date parsing works in every browser.
            let ts = ev.timestamp;
            try {
              if (ts && !ts.endsWith("Z") && !/\.\d{3}/.test(ts)) {
                ts = new Date(ts).toISOString();
              }
            } catch {
              ts = new Date().toISOString();
            }
            const status = (ev.event || "").toString().trim().toLowerCase().replace(/\s+/g, "_") || "update";
            const newEntry = {
              status,
              timestamp: ts,
              location: ev.location || "",
              notes: ev.notes || "",
            };
            const key = `${ts}|${status}`;
            const idx = merged.findIndex(
              (m: any) => `${m.timestamp}|${m.status}` === key
            );
            if (idx >= 0) merged[idx] = newEntry;
            else merged.push(newEntry);

            if (!latestEvent || new Date(ts) > new Date(latestEvent.timestamp)) {
              latestEvent = newEntry;
            }
          });

          // Sort timeline newest-first so the tracking page can render the
          // "Latest" badge on the first item without re-sorting.
          merged.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

          const update: Record<string, any> = {
            status_timeline: merged,
            updated_at: new Date().toISOString(),
          };

          // Bump current_status to the newest event's status, unless the
          // parcel is already at a terminal state (delivered / cancelled /
          // returned) — we don't want to accidentally regress a delivered
          // parcel back to "in_transit" if a staff member edits an older
          // event in the manifest's Tracking Events tab.
          if (latestEvent) {
            const terminal = ["delivered", "cancelled", "returned"];
            if (!terminal.includes(String(r.current_status).toLowerCase())) {
              update.current_status = latestEvent.status;
            }
            // Mirror the latest non-empty note into admin_note so the
            // prominent "Note from SkyXpress" callout on the public page
            // reflects what staff just wrote.
            if (latestEvent.notes && String(latestEvent.notes).trim()) {
              update.admin_note = String(latestEvent.notes).trim();
              // Also mirror into status_notes for parity with the
              // PublicTracking.tsx lookup path.
              update.status_notes = String(latestEvent.notes).trim();
            }
            // FIX: also push the latest event's location into the
            // `current_location` and `detailed_status.location` columns
            // so any tracking page that reads those (instead of the
            // timeline) shows the fresh value too. PublicTracking.tsx
            // already reads these; the boarding pass now does as well.
            if (latestEvent.location && String(latestEvent.location).trim()) {
              const loc = String(latestEvent.location).trim();
              update.current_location = loc;
              update.last_location = loc;
              // Merge into existing detailed_status (object form) without
              // dropping any other keys that might already be there.
              const existingDetailed =
                r.detailed_status && typeof r.detailed_status === "object" && !Array.isArray(r.detailed_status)
                  ? { ...r.detailed_status }
                  : {};
              existingDetailed.location = loc;
              if (latestEvent.notes && String(latestEvent.notes).trim()) {
                existingDetailed.notes = String(latestEvent.notes).trim();
              }
              existingDetailed.updated_at = new Date().toISOString();
              update.detailed_status = existingDetailed;
            }
          }

          // Resilient write (same fallback as cascadeStatusToParcels): if the
          // database is missing the optional note/location columns, retry with
          // status_timeline/current_status/updated_at only so tracking events
          // still land on the public tracking page.
          const result = await updateParcelRowResilient(r.id, update);
          if (!result.ok) {
            console.warn(
              `[ManifestStock] failed to sync tracking events to parcel ${r.tracking_id}:`,
              result.error
            );
          } else if (result.schemaFallback) {
            console.warn(
              `[ManifestStock] tracking-event note/location columns missing for ${r.tracking_id} — ` +
              `event synced to timeline without note mirroring. Run supabase-parcels-status-sync.sql.`
            );
          }
        })
      );
    } catch (err) {
      console.warn("[ManifestStock] tracking-events sync error:", err);
    }
  };

  const handleBulkStatusApply = async () => {
    if (!bulkStatus || selectedIds.size === 0) return;
    const results = await Promise.all(
      [...selectedIds].map((id) => {
        const entry = entries.find((e) => e.manifestId === id);
        return cascadeStatusToParcels(id, bulkStatus, entry?.parcels || [], bulkComment);
      })
    );
    await reload();
    const label = MANIFEST_STATUSES.find((s) => s.value === bulkStatus)?.label || bulkStatus;
    const count = selectedIds.size;
    const failedCount = results.reduce((s, r) => s + r.syncErrors.length, 0);
    const missingCount = results.reduce((s, r) => s + r.missingTrackingIds.length, 0);
    const schemaFallbackCount = results.reduce((s, r) => s + (r.schemaFallback ? 1 : 0), 0);
    setSelectedIds(new Set());
    setShowBulkDialog(false);
    if (failedCount > 0 || missingCount > 0) {
      toast({
        title: "Status updated, but tracking sync had issues",
        description: `${count} manifest(s) → ${label}. ${failedCount} parcel(s) failed to sync (see console)${missingCount ? `, ${missingCount} not found in parcels table` : ""}.`,
        variant: "destructive",
      });
    } else if (schemaFallbackCount > 0) {
      // Status DID sync for these manifests, but the database is missing the
      // optional note/location columns so comments weren't mirrored.
      toast({
        title: `Status updated ✓ (${count} manifest(s) → ${label})`,
        description: "Parcel statuses synced. Note: your database is missing optional columns (admin_note, current_location, …) so comments/locations weren't mirrored — run supabase-parcels-status-sync.sql in the Supabase SQL Editor to enable full sync.",
      });
    } else {
      toast({ title: `Status updated ✓`, description: `${count} manifest(s) → ${label}${bulkComment ? " · comment added" : ""} (parcels synced)` });
    }
    setBulkStatus("");
    setBulkComment("");
  };

  const handleSingleStatus = async (manifestId: string, status: string, comment?: string) => {
    const entry = entries.find((e) => e.manifestId === manifestId);
    const sourceParcels = editing?.manifestId === manifestId ? editing.parcels : entry?.parcels || [];
    const { updatedParcels, syncErrors, missingTrackingIds, schemaFallback } = await cascadeStatusToParcels(
      manifestId,
      status,
      sourceParcels,
      comment
    );
    await reload();
    if (editing?.manifestId === manifestId) {
      setEditing((e) => e ? { ...e, manifestStatus: status, parcels: updatedParcels || e.parcels } : e);
    }
    const label = MANIFEST_STATUSES.find((s) => s.value === status)?.label || status;
    if (syncErrors.length > 0 || missingTrackingIds.length > 0) {
      toast({
        title: "Status updated, but tracking sync failed",
        description: `${manifestId} → ${label} saved to the manifest, but ${syncErrors.length} parcel(s) did not sync to public tracking${missingTrackingIds.length ? ` (${missingTrackingIds.length} tracking ID not found)` : ""}. Check console for details.`,
        variant: "destructive",
      });
    } else if (schemaFallback) {
      // The status DID reach the parcels table via the core-column fallback —
      // only the optional comment/location mirroring was skipped.
      toast({
        title: "Status updated ✓ (parcels synced)",
        description: `${manifestId} → ${label}. Note: your database is missing optional columns (admin_note, current_location, …) so the comment/location weren't mirrored — run supabase-parcels-status-sync.sql in the Supabase SQL Editor to enable full sync.`,
      });
    } else {
      toast({ title: "Status updated ✓", description: `${manifestId} → ${label}${comment ? " · comment added" : ""} (parcels synced)` });
    }
  };

  // Opens the confirm dialog instead of applying instantly, so a comment can
  // be attached before the status change is pushed to tracking.
  const openSingleStatusDialog = (manifestId: string, status: string) =>
    setSingleStatusDialog({ open: true, manifestId, status, comment: "" });

  const confirmSingleStatus = async () => {
    const { manifestId, status, comment } = singleStatusDialog;
    if (!manifestId || !status) return;
    await handleSingleStatus(manifestId, status, comment.trim() || undefined);
    setSingleStatusDialog({ open: false, manifestId: "", status: "", comment: "" });
  };

  const filtered = entries.filter((e) => {
    // ── Admin partner filter (dropdown) ────────────────────────────────────
    if (isAdminView && partnerFilter !== "all") {
      if (e.partnerUserId !== partnerFilter) return false;
    }

    // ── Partner scope: match by UUID or email (when rendered inside partner dashboard) ──
    if (filterUserId) {
      const matchesId    = e.partnerUserId === filterUserId;
      const matchesEmail = filterEmail
        ? (e.createdByUser || "").toLowerCase() === filterEmail.toLowerCase()
        : false;
      if (!matchesId && !matchesEmail) return false;
    } else if (filterEmail && (e.createdByUser || "").toLowerCase() !== filterEmail.toLowerCase()) {
      return false;
    }

    // ── Text search ────────────────────────────────────────────────────────
    const q = search.toLowerCase();
    return (
      !q ||
      e.manifestId.toLowerCase().includes(q) ||
      e.trackingIds.some((id) => id.toLowerCase().includes(q)) ||
      (e.serviceType || "").toLowerCase().includes(q) ||
      (e.fromCountry || "").toLowerCase().includes(q) ||
      (e.toCountry || "").toLowerCase().includes(q) ||
      (e.flightNo || "").toLowerCase().includes(q) ||
      (e.originHub || "").toLowerCase().includes(q) ||
      (e.destinationHub || "").toLowerCase().includes(q)
    );
  });

  // Stats for the currently-selected partner filter (admin view)
  const partnerFilteredParcels = filtered.reduce((s, e) => s + e.parcelCount, 0);

  const filteredAwbs = editing
    ? editing.parcels.filter((p) => {
        const q = awbSearch.toLowerCase();
        return !q || p.tracking_id.toLowerCase().includes(q) || (p.sender_name || "").toLowerCase().includes(q);
      })
    : [];

  const computedActual = editing ? editing.parcels.reduce((s, p) => s + Number(p.weight ?? 0), 0).toFixed(2) : "0.00";
  const computedPcs    = editing ? editing.parcels.reduce((s, p) => s + (p.pieces ?? 1), 0) : 0;
  const computedAwb    = editing ? editing.parcels.length : 0;

  return (
    <div className="space-y-5">

      {/* ── Stats ────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: "Total Manifests", value: entries.length, icon: ClipboardList, color: "text-blue-600", bg: "bg-blue-50", border: "border-blue-100" },
          { label: "Total Parcels",   value: entries.reduce((s, e) => s + e.parcelCount, 0), icon: Package, color: "text-orange-600", bg: "bg-orange-50", border: "border-orange-100" },
          { label: "Total Weight",    value: `${entries.reduce((s, e) => s + e.totalWeight, 0).toFixed(1)} kg`, icon: Weight, color: "text-green-600", bg: "bg-green-50", border: "border-green-100" },
          { label: "Total Value",     value: entries.length > 0 ? `${entries[0].currency} ${entries.reduce((s, e) => s + e.totalValue, 0).toFixed(2)}` : "—", icon: DollarSign, color: "text-purple-600", bg: "bg-purple-50", border: "border-purple-100" },
        ].map(({ label, value, icon: Icon, color, bg, border }) => (
          <Card key={label} className={`border ${border} shadow-sm`}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`${bg} p-2.5 rounded-xl border ${border}`}>
                <Icon className={`h-5 w-5 ${color}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground font-medium">{label}</p>
                <p className="text-xl font-bold text-slate-800">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── List Card ────────────────────────────────────────────────────────── */}
      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2 text-slate-800">
              <ClipboardList className="h-5 w-5 text-blue-600" />
              Manifest Stock
              {entries.length > 0 && (
                <Badge variant="secondary" className="ml-1 bg-blue-100 text-blue-700">{entries.length}</Badge>
              )}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm"
                className="gap-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-sm border border-blue-700"
                onClick={() => {
                  // Open the multi-parcel Create Manifest wizard (default entry point).
                  // The list of existing manifests stays visible behind the dialog.
                  setShowCreateManifestDialog(true);
                  setPendingParcels([]);
                  setRefIdInput("");
                }}>
                <Plus className="h-3.5 w-3.5" /> Create Manifest
              </Button>
              <Button variant="outline" size="sm"
                className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                onClick={() => { setShowFindParcelDialog(true); setFindParcelQuery(""); setFindParcelResults([]); }}>
                <Search className="h-3.5 w-3.5" /> Find Parcel by Ref ID
              </Button>
              <Button variant="outline" size="sm" onClick={reload} className="gap-2 border-slate-300">
                <RefreshCw className="h-3.5 w-3.5" /> Refresh
              </Button>
            </div>
          </div>
          {/* ── Admin partner filter ────────────────────────────────────── */}
          {isAdminView && partners.length > 0 && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select value={partnerFilter} onValueChange={(v) => { setPartnerFilter(v); setSelectedIds(new Set()); }}>
                <SelectTrigger className="w-56 h-8 text-sm bg-white border-slate-300">
                  <SelectValue placeholder="All Partners" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    <span className="font-medium">All Partners</span>
                  </SelectItem>
                  {partners.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {partnerFilter !== "all" && (
                <div className="flex items-center gap-2">
                  <Badge className="bg-blue-100 text-blue-700 border-blue-200 text-xs">
                    {filtered.length} manifest{filtered.length !== 1 ? "s" : ""}
                  </Badge>
                  <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-xs">
                    {partnerFilteredParcels} parcel{partnerFilteredParcels !== 1 ? "s" : ""}
                  </Badge>
                  <button
                    onClick={() => setPartnerFilter("all")}
                    className="text-xs text-muted-foreground hover:text-slate-700 underline"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="relative mt-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search manifest ID, tracking, flight, hub, destination…"
              value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10 bg-white" />
          </div>
        </CardHeader>

        <CardContent>
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
              <div className="rounded-full bg-slate-100 p-5">
                <ClipboardList className="h-10 w-10 text-slate-300" />
              </div>
              <div>
                <p className="font-semibold text-slate-600">No manifests found</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Select parcels in Parcel Management and click "Generate Manifest"
                </p>
              </div>
            </div>
          ) : (
            <>
              {selectedIds.size > 0 && (
                <div className="mb-3 flex items-center gap-3 bg-gradient-to-r from-blue-700 to-blue-900 rounded-xl px-4 py-3 flex-wrap shadow-md">
                  <ListChecks className="h-4 w-4 text-blue-200" />
                  <span className="text-white text-sm font-semibold">{selectedIds.size} manifest{selectedIds.size > 1 ? "s" : ""} selected</span>
                  <div className="flex items-center gap-2 ml-auto flex-wrap">
                    <span className="text-blue-200 text-xs font-medium">Set status:</span>
                    {MANIFEST_STATUSES.map((s) => (
                      <button key={s.value}
                        onClick={() => { setBulkStatus(s.value); setBulkComment(""); setShowBulkDialog(true); }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer transition-transform hover:scale-105 active:scale-95 ${s.tw}`}>
                        <span>{s.icon}</span>{s.label}
                      </button>
                    ))}
                    <button onClick={() => setSelectedIds(new Set())} className="text-blue-300 hover:text-white text-xs underline ml-1">
                      Deselect all
                    </button>
                  </div>
                </div>
              )}

              {/* ── Desktop table (md+) ────────────────────────────────────── */}
              <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-100">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-gradient-to-r from-slate-800 to-blue-900 hover:from-slate-800 hover:to-blue-900">
                      <TableHead className="text-white w-10 py-3">
                        <Checkbox
                          checked={filtered.length > 0 && selectedIds.size === filtered.length}
                          onCheckedChange={toggleSelectAll}
                          className="border-white/40 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                        />
                      </TableHead>
                      {["Manifest ID","Date","Parcels","Route","Destination Hub","Weight","Service","Branch / Made By","Flight","Status","Lock","Actions"].map(h => (
                        <TableHead key={h} className="text-white font-bold text-xs py-3">{h}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((entry, i) => (
                      <TableRow key={entry.manifestId}
                        className={`cursor-pointer transition-colors ${selectedIds.has(entry.manifestId) ? "bg-blue-50 ring-1 ring-blue-300" : i % 2 === 0 ? "bg-white hover:bg-blue-50/50" : "bg-slate-50/40 hover:bg-blue-50/50"}`}
                        onClick={() => openDetail(entry)}>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox checked={selectedIds.has(entry.manifestId)} onCheckedChange={() => toggleSelect(entry.manifestId)}
                            className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {entry.isLocked && <Lock className="h-3 w-3 text-slate-400 flex-shrink-0" />}
                            <span className="font-mono font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded text-sm tracking-wider border border-orange-100">{entry.manifestId}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-sm text-slate-700">
                            <Calendar className="h-3.5 w-3.5 text-slate-400" />
                            {new Date(entry.createdAt).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{new Date(entry.createdAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5"><Package className="h-3.5 w-3.5 text-blue-400" /><span className="font-semibold text-slate-800">{entry.parcelCount}</span><span className="text-xs text-muted-foreground">AWBs</span></div>
                          <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{entry.trackingIds.slice(0, 2).join(", ")}{entry.trackingIds.length > 2 && ` +${entry.trackingIds.length - 2}`}</div>
                        </TableCell>
                        <TableCell><div className="text-sm font-medium text-slate-700">{entry.fromCountry || "—"}</div><div className="text-xs text-muted-foreground">→ {entry.toCountry || "—"}</div></TableCell>
                        <TableCell><div className="text-xs text-slate-600 max-w-[120px] truncate" title={entry.destinationHub}>{entry.destinationHub || <span className="text-slate-300">—</span>}</div></TableCell>
                        <TableCell><span className="font-semibold text-slate-800">{entry.totalWeight.toFixed(2)}</span><span className="text-xs text-muted-foreground ml-1">kg</span></TableCell>
                        <TableCell><Badge variant="outline" className="text-xs border-slate-200 text-slate-600">{entry.serviceType}</Badge></TableCell>
                        <TableCell>{(() => { const pInfo = partnerProfileMap[entry.partnerUserId || ""]; const branch = pInfo?.branch || entry.company; const username = pInfo?.username; return branch || entry.createdByUser || username ? (<div className="space-y-0.5">{branch && <div className="flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5 max-w-[130px] truncate" title={branch}><Building2 className="h-2.5 w-2.5 flex-shrink-0" />{branch}</div>}{entry.createdByUser && <div className="text-[11px] font-semibold text-sky-700 bg-sky-50 border border-sky-100 rounded px-1.5 py-0.5 inline-block max-w-[130px] truncate" title={entry.createdByUser}>{entry.createdByUser}</div>}{username && <div className="flex items-center gap-1 text-[10px] font-semibold text-purple-700 bg-purple-50 border border-purple-100 rounded px-1.5 py-0.5 max-w-[130px] truncate" title={username}><User className="h-2.5 w-2.5 flex-shrink-0" />{username}</div>}</div>) : <span className="text-slate-300 text-xs">—</span>; })()}</TableCell>
                        <TableCell>{entry.flightNo ? <div className="flex items-center gap-1 text-xs text-slate-700"><Plane className="h-3 w-3 text-blue-400" />{entry.flightNo}</div> : <span className="text-slate-300 text-xs">—</span>}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Select value={entry.manifestStatus || ""} onValueChange={(v) => openSingleStatusDialog(entry.manifestId, v)}>
                            <SelectTrigger className="h-7 w-[150px] text-[11px] border-slate-200 bg-white px-2 py-0">
                              <SelectValue placeholder="Set status…">{entry.manifestStatus ? <ManifestStatusBadge status={entry.manifestStatus} size="xs" /> : <span className="text-slate-400 text-[11px]">Set status…</span>}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>{MANIFEST_STATUSES.map((s) => (<SelectItem key={s.value} value={s.value}><span className="flex items-center gap-2"><span>{s.icon}</span><span>{s.label}</span></span></SelectItem>))}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>{entry.isLocked ? <Badge className="bg-slate-700 text-white text-[10px] gap-1"><Lock className="h-2.5 w-2.5" /> Locked</Badge> : <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">Open</Badge>}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center gap-1 justify-end">
                            <Button variant="ghost" size="sm" title="Excel" className="gap-1 text-green-700 hover:bg-green-50 h-7 px-2" onClick={() => handleExcelDownload(entry)} disabled={downloading === entry.manifestId + "-xls"}><FileSpreadsheet className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="sm" title="PDF" className="gap-1 text-blue-700 hover:bg-blue-50 h-7 px-2" onClick={() => handlePDFDownload(entry)} disabled={downloading === entry.manifestId + "-pdf"}><FileDown className="h-3.5 w-3.5" /></Button>
                            {canDeleteManifest && (
                              <Button variant="ghost" size="sm" title="Delete" className="text-red-400 hover:text-red-600 hover:bg-red-50 h-7 px-2" onClick={() => handleDelete(entry.manifestId)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ── Mobile cards (< md) ────────────────────────────────────── */}
              <div className="md:hidden rounded-xl border border-slate-100 overflow-hidden divide-y divide-slate-100">
                {/* Select-all row */}
                <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-800 to-blue-900">
                  <Checkbox checked={filtered.length > 0 && selectedIds.size === filtered.length} onCheckedChange={toggleSelectAll}
                    className="border-white/40 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500" />
                  <span className="text-white text-xs font-semibold">Select all</span>
                </div>
                {filtered.map((entry, i) => (
                  <div key={entry.manifestId}
                    className={`px-4 py-3 cursor-pointer ${selectedIds.has(entry.manifestId) ? "bg-blue-50" : i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}`}
                    onClick={() => openDetail(entry)}>
                    {/* Top: checkbox + manifest ID + lock/status */}
                    <div className="flex items-start gap-3">
                      <div onClick={(e) => e.stopPropagation()} className="mt-0.5 shrink-0">
                        <Checkbox checked={selectedIds.has(entry.manifestId)} onCheckedChange={() => toggleSelect(entry.manifestId)}
                          className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            {entry.isLocked && <Lock className="h-3 w-3 text-slate-400 shrink-0" />}
                            <span className="font-mono font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded text-sm tracking-wider border border-orange-100">{entry.manifestId}</span>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {entry.isLocked
                              ? <Badge className="bg-slate-700 text-white text-[10px] gap-1"><Lock className="h-2.5 w-2.5" /> Locked</Badge>
                              : <Badge className="bg-green-100 text-green-700 border-green-200 text-[10px]">Open</Badge>}
                            {entry.manifestStatus && <ManifestStatusBadge status={entry.manifestStatus} size="xs" />}
                          </div>
                        </div>
                        {/* Details grid */}
                        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                          <div>
                            <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wide mb-0.5">Date</p>
                            <p className="text-xs text-slate-700">{new Date(entry.createdAt).toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" })}</p>
                            <p className="text-[10px] text-slate-400">{new Date(entry.createdAt).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit" })}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wide mb-0.5">Parcels</p>
                            <p className="text-xs font-semibold text-slate-800">{entry.parcelCount} AWBs</p>
                            <p className="text-[10px] text-slate-400 font-mono truncate">{entry.trackingIds.slice(0,1).join("")}{entry.trackingIds.length > 1 && ` +${entry.trackingIds.length - 1}`}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wide mb-0.5">Route</p>
                            <p className="text-xs text-slate-700">{entry.fromCountry || "—"} → {entry.toCountry || "—"}</p>
                          </div>
                          <div>
                            <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wide mb-0.5">Weight · Service</p>
                            <p className="text-xs text-slate-700">{entry.totalWeight.toFixed(2)} kg · {entry.serviceType}</p>
                          </div>
                          {(entry.destinationHub || entry.flightNo) && (
                            <div className="col-span-2">
                              <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wide mb-0.5">Hub · Flight</p>
                              <p className="text-xs text-slate-600 truncate">{[entry.destinationHub, entry.flightNo].filter(Boolean).join(" · ") || "—"}</p>
                            </div>
                          )}
                        </div>
                        {/* Status picker + actions */}
                        <div className="mt-2.5 flex items-center gap-2 flex-wrap" onClick={(e) => e.stopPropagation()}>
                          <Select value={entry.manifestStatus || ""} onValueChange={(v) => openSingleStatusDialog(entry.manifestId, v)}>
                            <SelectTrigger className="h-7 w-[140px] text-[11px] border-slate-200 bg-white px-2 py-0">
                              <SelectValue placeholder="Set status…">{entry.manifestStatus ? <ManifestStatusBadge status={entry.manifestStatus} size="xs" /> : <span className="text-slate-400 text-[11px]">Set status…</span>}</SelectValue>
                            </SelectTrigger>
                            <SelectContent>{MANIFEST_STATUSES.map((s) => (<SelectItem key={s.value} value={s.value}><span className="flex items-center gap-2"><span>{s.icon}</span><span>{s.label}</span></span></SelectItem>))}</SelectContent>
                          </Select>
                          <Button variant="ghost" size="sm" title="Excel" className="h-7 px-2 text-green-700 hover:bg-green-50" onClick={() => handleExcelDownload(entry)} disabled={downloading === entry.manifestId + "-xls"}><FileSpreadsheet className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" title="PDF" className="h-7 px-2 text-blue-700 hover:bg-blue-50" onClick={() => handlePDFDownload(entry)} disabled={downloading === entry.manifestId + "-pdf"}><FileDown className="h-4 w-4" /></Button>
                          {canDeleteManifest && (
                            <Button variant="ghost" size="sm" title="Delete" className="h-7 px-2 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(entry.manifestId)}><Trash2 className="h-4 w-4" /></Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── MANIFEST DETAIL — pop-up modal (Dialog) ───────────────────────── */}
      {/* Was previously an inline panel rendered below the list, which pushed all */}
      {/* the manifests down and was a poor UX. Now opens as a full-screen modal. */}
      {/* The inner content is gated with `{selected && editing && (...)}` (NOT just */}
      {/* the Dialog's `open` prop) because Radix keeps DialogContent mounted during */}
      {/* the exit animation. Without this inner gate, `editing` is null by the time */}
      {/* the close animation runs, and the inner JSX crashes accessing editing.* — */}
      {/* which was what was crashing the website. */}
      <Dialog open={!!selected && !!editing} onOpenChange={(o) => { if (!o) closeDetail(); }}>
        <DialogContent className="max-w-[95vw] w-full max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col [&>button]:hidden">
          {selected && editing && (
          <div className="flex flex-col flex-1 overflow-hidden">
          <>
            {/* Top header */}
            <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 px-4 py-3 flex items-center justify-between flex-wrap gap-2 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-orange-400" />
                    <span className="text-white font-bold text-sm tracking-wide">MANIFEST DETAIL</span>
                  </div>
                  <span className="font-mono text-orange-400 bg-orange-500/10 border border-orange-500/30 px-2 py-0.5 rounded text-sm font-bold tracking-widest">
                    {editing.manifestId}
                  </span>
                  {editing.isLocked && <Badge className="bg-red-600 text-white text-[10px]"><Lock className="h-2.5 w-2.5 mr-1" />Locked</Badge>}
                  {currentUser && (
                    <span className="hidden sm:flex items-center gap-1 text-blue-300 text-[11px]">
                      <User className="h-3 w-3" />{currentUser.email}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button size="sm" variant="outline"
                    className="h-7 text-xs border-white/20 text-white hover:bg-white/10 bg-transparent gap-1.5"
                    onClick={handleClone}>
                    <Copy className="h-3 w-3" /><span className="hidden sm:inline">Clone</span>
                  </Button>
                  <Button size="sm"
                    className={`h-7 text-xs gap-1.5 ${editing.isLocked ? "bg-orange-500 hover:bg-orange-600" : "bg-slate-600 hover:bg-slate-500"} text-white`}
                    onClick={handleLockToggle}>
                    {editing.isLocked ? <><Unlock className="h-3 w-3" /><span className="hidden sm:inline"> Unlock</span></> : <><Lock className="h-3 w-3" /><span className="hidden sm:inline"> Lock</span></>}
                  </Button>
                  <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
                    onClick={() => handleExcelDownload(editing)} disabled={downloading === editing.manifestId + "-xls"}>
                    <FileSpreadsheet className="h-3 w-3" /><span className="hidden sm:inline">Excel</span>
                  </Button>
                  <Button size="sm"
                    className="h-7 text-xs bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700 text-white gap-1.5"
                    onClick={() => handlePDFDownload(editing)} disabled={downloading === editing.manifestId + "-pdf"}>
                    <FileDown className="h-3 w-3" /><span className="hidden sm:inline">PDF</span>
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-white/60 hover:text-white hover:bg-white/10" onClick={closeDetail}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Sub-header: tabs + actions */}
              <div className="bg-slate-100 border-b border-slate-200 flex-shrink-0">
                <Tabs defaultValue="entry" className="w-full">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between px-2 sm:px-4 pt-0 gap-0">
                    <div className="overflow-x-auto">
                      <TabsList className="h-9 bg-transparent gap-0 rounded-none border-0 p-0 flex w-max">
                        {[
                          { value: "entry",    label: "Entry",         shortLabel: "Entry",    icon: ClipboardList },
                          { value: "tracking", label: "Add Tracking",  shortLabel: "Tracking", icon: MapPin },
                          { value: "billing",  label: "Billing",       shortLabel: "Billing",  icon: DollarSign },
                        ].map(({ value, label, icon: Icon }) => (
                          <TabsTrigger key={value} value={value}
                            className="h-9 px-3 sm:px-4 rounded-none text-xs font-semibold uppercase tracking-wide border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:text-blue-700 data-[state=active]:bg-white data-[state=active]:shadow-none text-slate-500 hover:text-slate-700 transition-none whitespace-nowrap">
                            <Icon className="h-3 w-3 mr-1.5" />{label}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </div>
                    <div className="flex items-center gap-2 px-2 pb-2 sm:px-0 sm:pb-0">
                      <Button size="sm"
                        className="h-7 text-[11px] bg-blue-700 hover:bg-blue-800 text-white gap-1"
                        onClick={handleSave} disabled={saving || editing.isLocked}>
                        {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        {saving ? "Saving…" : "Update Manifest"}
                      </Button>
                      <Button size="sm" variant="outline"
                        className="h-7 text-[11px] border-slate-300 text-slate-600 gap-1"
                        onClick={() => setShowHistory(true)}>
                        <History className="h-3 w-3" /> History
                      </Button>
                    </div>
                  </div>

                  {/* Scrollable content — maxHeight dropped; flex-1 fills the dialog instead */}
                  <div className="overflow-y-auto flex-1">

                    {/* ══ ENTRY TAB ══════════════════════════════════════════ */}
                    <TabsContent value="entry" className="m-0 p-4 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                        {/* LEFT column — Manifest Info */}
                        <div className="space-y-3 bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-1.5">Manifest Info</p>
                          <Field label="Booking From Date" type="date" value={editing.bookingFromDate}
                            onChange={(v) => setEditField("bookingFromDate", v)} disabled={editing.isLocked} />
                          <Field label="Booking Till Date" type="date" value={editing.bookingTillDate}
                            onChange={(v) => setEditField("bookingTillDate", v)} disabled={editing.isLocked} />
                          <Field label="Manifest No." value={editing.manifestId} readOnly />
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Forwarder</Label>
                            <Input value={editing.forwarder ?? ""} onChange={(e) => setEditField("forwarder", e.target.value)}
                              placeholder="Forwarder name" className="h-8 text-sm border-slate-200" disabled={editing.isLocked} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Service</Label>
                            <Select value={editing.service ?? ""} onValueChange={(v) => setEditField("service", v)} disabled={editing.isLocked}>
                              <SelectTrigger className="h-8 text-sm border-slate-200">
                                <SelectValue placeholder="Select service" />
                              </SelectTrigger>
                              <SelectContent>
                                {SERVICES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <Field label="Master No." value={editing.masterNo}
                            onChange={(v) => setEditField("masterNo", v)} disabled={editing.isLocked} />
                          <Field label="Master EDI Bag No" value={editing.masterEdiBagNo}
                            onChange={(v) => setEditField("masterEdiBagNo", v)} disabled={editing.isLocked} />
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Remark</Label>
                            <Textarea value={editing.remark ?? ""} onChange={(e) => setEditField("remark", e.target.value)}
                              placeholder="Any remarks…" rows={2} className="text-sm border-slate-200 resize-none" disabled={editing.isLocked} />
                          </div>
                          {/* Created By — auto-filled from auth user */}
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider flex items-center gap-1">
                              <User className="h-3 w-3" /> Created By
                            </Label>
                            <div className="h-8 px-2 flex items-center gap-2 text-sm bg-blue-50 border border-blue-100 rounded text-blue-700 font-medium">
                              <User className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
                              <span className="truncate">{currentUser?.email || editing.createdByUser || "—"}</span>
                            </div>
                            {currentUser?.name && currentUser.name !== currentUser?.email && (
                              <p className="text-[10px] text-slate-400 mt-0.5">{currentUser.name}</p>
                            )}
                          </div>

                          {/* Manifest Status picker */}
                          <div className="space-y-1.5">
                            <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider flex items-center gap-1">
                              <Tag className="h-3 w-3" /> Manifest Status
                            </Label>
                            <div className="grid grid-cols-1 gap-1.5 max-h-64 overflow-y-auto pr-1">
                              {MANIFEST_STATUSES.map((s) => {
                                const active = (editing.manifestStatus || "") === s.value;
                                return (
                                  <button key={s.value} disabled={editing.isLocked}
                                    onClick={() => openSingleStatusDialog(editing.manifestId, s.value)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold border-2 transition-all text-left
                                      ${active
                                        ? `${s.tw} border-transparent shadow-md scale-[1.02]`
                                        : "bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:bg-blue-50"
                                      }
                                      ${editing.isLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}>
                                    <span className="text-base leading-none">{s.icon}</span>
                                    <span>{s.label}</span>
                                    {active && <CheckCircle2 className="h-3.5 w-3.5 ml-auto opacity-80" />}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {/* MIDDLE column — Flight & Shipment */}
                        <div className="space-y-3 bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-1.5">Flight & Shipment</p>
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Date" type="date" value={editing.manifestDate}
                              onChange={(v) => setEditField("manifestDate", v)} disabled={editing.isLocked} />
                            <Field label="Time" type="time" value={editing.manifestTime}
                              onChange={(v) => setEditField("manifestTime", v)} disabled={editing.isLocked} />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Run Number</Label>
                            <Input value={editing.runNumber ?? ""} onChange={(e) => setEditField("runNumber", e.target.value)}
                              placeholder="Run number" className="h-8 text-sm border-slate-200" disabled={editing.isLocked} />
                          </div>
                          <Field label="Flight No" value={editing.flightNo}
                            onChange={(v) => setEditField("flightNo", v)} placeholder="e.g. PK-301" disabled={editing.isLocked} />
                          <Field label="No. of Bags" type="number" value={editing.noOfBags ?? ""}
                            onChange={(v) => setEditField("noOfBags", Number(v))} disabled={editing.isLocked} />
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="Arrival Date" type="date" value={editing.arrivalDate}
                              onChange={(v) => setEditField("arrivalDate", v)} disabled={editing.isLocked} />
                            <Field label="Arrival Time" type="time" value={editing.arrivalTime}
                              onChange={(v) => setEditField("arrivalTime", v)} disabled={editing.isLocked} />
                          </div>
                          <Field label="Company" value={editing.company}
                            onChange={(v) => setEditField("company", v)} disabled={editing.isLocked} />

                          {/* License — select from DB + inline create */}
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">License</Label>
                            {!addingLicense ? (
                              <div className="flex gap-1.5">
                                <select
                                  value={editing.license ?? ""}
                                  disabled={editing.isLocked}
                                  onChange={(e) => setEditField("license", e.target.value)}
                                  className="h-8 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <option value="">— Select license —</option>
                                  {licenses.map((opt) => (
                                    <option key={opt} value={opt}>{opt}</option>
                                  ))}
                                </select>
                                {!editing.isLocked && (
                                  <Button
                                    type="button" size="sm" variant="outline"
                                    className="h-8 px-2 border-blue-200 text-blue-600 hover:bg-blue-50"
                                    onClick={() => { setAddingLicense(true); setNewLicenseCode(""); }}
                                    title="Add new license"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            ) : (
                              <div className="flex gap-1.5">
                                <Input
                                  autoFocus
                                  value={newLicenseCode}
                                  onChange={(e) => setNewLicenseCode(e.target.value.toUpperCase())}
                                  placeholder="e.g. MCS-ISB-03"
                                  className="h-8 flex-1 text-sm border-blue-300 focus-visible:ring-blue-500"
                                  onKeyDown={async (e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      if (!newLicenseCode.trim()) return;
                                      setSavingLicense(true);
                                      try {
                                        const saved = await createLicense(newLicenseCode);
                                        const updated = await fetchLicenses();
                                        setLicenses(updated);
                                        setEditField("license", saved);
                                        setAddingLicense(false);
                                        toast({ title: "License saved", description: saved });
                                      } catch (err: any) {
                                        toast({ title: "Error", description: err.message, variant: "destructive" });
                                      } finally { setSavingLicense(false); }
                                    }
                                    if (e.key === "Escape") { setAddingLicense(false); setNewLicenseCode(""); }
                                  }}
                                />
                                <Button
                                  type="button" size="sm"
                                  disabled={savingLicense || !newLicenseCode.trim()}
                                  className="h-8 px-2 bg-blue-600 hover:bg-blue-700 text-white"
                                  onClick={async () => {
                                    if (!newLicenseCode.trim()) return;
                                    setSavingLicense(true);
                                    try {
                                      const saved = await createLicense(newLicenseCode);
                                      const updated = await fetchLicenses();
                                      setLicenses(updated);
                                      setEditField("license", saved);
                                      setAddingLicense(false);
                                      toast({ title: "License saved", description: saved });
                                    } catch (err: any) {
                                      toast({ title: "Error", description: err.message, variant: "destructive" });
                                    } finally { setSavingLicense(false); }
                                  }}
                                >
                                  {savingLicense ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                </Button>
                                <Button
                                  type="button" size="sm" variant="outline"
                                  className="h-8 px-2 border-slate-200 text-slate-500"
                                  onClick={() => { setAddingLicense(false); setNewLicenseCode(""); }}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>

                          <Separator className="my-1" />
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Weight Summary</p>
                          <Field label="Vendor Weight (kg)" type="number" value={editing.vendorWeight ?? ""}
                            onChange={(v) => setEditField("vendorWeight", Number(v))} disabled={editing.isLocked} />
                          <Field label="Total Actual Wt (kg)" value={computedActual} readOnly />
                          <Field label="Total Volumetric Wt (kg)" type="number" value={editing.totalVolumetricWt ?? ""}
                            onChange={(v) => setEditField("totalVolumetricWt", Number(v))} disabled={editing.isLocked} />
                          <Field label="Total Chargeable Wt (kg)" value={
                            editing.totalVolumetricWt && Number(editing.totalVolumetricWt) > Number(computedActual)
                              ? editing.totalVolumetricWt : computedActual
                          } readOnly />
                          <div className="grid grid-cols-2 gap-3">
                            <Field label="No. of AWB" value={computedAwb} readOnly />
                            <Field label="No. of PCS" value={computedPcs} readOnly />
                          </div>
                        </div>

                        {/* RIGHT column — Hubs & Files */}
                        <div className="space-y-3 bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-1.5">Hubs & Files</p>

                          {/* Origin Hub — searchable */}
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                              Origin Hub <span className="text-red-500">*</span>
                            </Label>
                            <SearchableSelect
                              value={editing.originHub ?? ""}
                              onChange={(v) => setEditField("originHub", v)}
                              options={ORIGIN_HUBS}
                              placeholder="Search origin hub…"
                              disabled={editing.isLocked}
                            />
                          </div>

                          {/* Destination Hub — searchable, worldwide */}
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                              Destination Hub <span className="text-slate-400 font-normal normal-case">(worldwide)</span>
                            </Label>
                            <SearchableSelect
                              value={editing.destinationHub ?? ""}
                              onChange={(v) => setEditField("destinationHub", v)}
                              options={DEST_HUBS}
                              placeholder="Search destination worldwide…"
                              disabled={editing.isLocked}
                            />
                          </div>

                          {/* EDI Excel File upload */}
                          <div className="space-y-1">
                            <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">EDI Excel File</Label>
                            <p className="text-[10px] text-orange-600 font-semibold">(UPLOAD EXCEL FILE ONLY)</p>
                            <label className="block">
                              <div className="h-8 px-3 flex items-center justify-between border border-slate-200 rounded text-sm cursor-pointer hover:border-blue-400 bg-white text-slate-500">
                                <span className="truncate text-xs">{csvFile?.name || "Choose Excel file…"}</span>
                                <UploadCloud className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                              </div>
                              <input type="file" accept=".xlsx,.xls" className="hidden"
                                onChange={(e) => setCsvFile(e.target.files?.[0] || null)} />
                            </label>
                          </div>

                          <Separator />

                          {/* Route summary */}
                          <div className="bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl border border-blue-100 p-3 space-y-2">
                            <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Route Summary</p>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-slate-500">FROM</p>
                                <p className="text-sm font-bold text-slate-800 truncate">{editing.originHub || editing.fromCountry || "—"}</p>
                              </div>
                              <Plane className="h-4 w-4 text-orange-500 flex-shrink-0" />
                              <div className="flex-1 min-w-0 text-right">
                                <p className="text-[10px] text-slate-500">TO</p>
                                <p className="text-sm font-bold text-slate-800 truncate">{editing.destinationHub || editing.toCountry || "—"}</p>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-1.5 pt-1">
                              {[
                                { label: "AWBs",   value: computedAwb },
                                { label: "Weight", value: `${computedActual} kg` },
                                { label: "Value",  value: `${editing.currency} ${editing.totalValue.toFixed(0)}` },
                              ].map(({ label, value }) => (
                                <div key={label} className="bg-white rounded-lg p-2 border border-blue-100 text-center">
                                  <p className="text-[9px] text-slate-400 uppercase">{label}</p>
                                  <p className="text-xs font-bold text-slate-700">{value}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Add Parcel by Reference ID */}
                      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="bg-slate-800 px-4 py-2.5 flex items-center gap-3 flex-wrap">
                          <span className="text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                            <Search className="h-3.5 w-3.5 text-orange-400" /> Add Parcel by Reference / Tracking ID
                          </span>
                          <div className="flex items-center gap-2 ml-auto">
                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                              <input
                                value={parcelSearchQuery}
                                onChange={(e) => setParcelSearchQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleParcelSearch(); } }}
                                placeholder="Reference ID or Tracking ID…"
                                disabled={editing.isLocked}
                                className="pl-6 h-7 text-xs bg-white/10 border border-white/20 rounded text-white placeholder-slate-400 focus:outline-none focus:border-white/40 w-56 disabled:opacity-50"
                              />
                            </div>
                            <Button size="sm" className="h-7 text-[11px] bg-blue-600 hover:bg-blue-700 text-white gap-1"
                              disabled={editing.isLocked || searchingParcels || !parcelSearchQuery.trim()}
                              onClick={handleParcelSearch}>
                              {searchingParcels ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                              Search
                            </Button>
                          </div>
                        </div>
                        {parcelSearchResults.length > 0 && (
                          <div className="divide-y divide-slate-50 max-h-52 overflow-y-auto">
                            {parcelSearchResults.map((p) => (
                              <div key={p.id || p.tracking_id} className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-blue-50/40">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-blue-600 text-xs">{p.tracking_id}</span>
                                    {p.reference_id && <span className="text-[10px] text-slate-400">Ref: {p.reference_id}</span>}
                                  </div>
                                  <p className="text-xs text-slate-600 truncate">
                                    {p.sender_name || "—"} → {p.receiver_name || "—"} · {p.weight ?? 0} kg
                                  </p>
                                </div>
                                <Button size="sm" className="h-7 text-[11px] bg-green-600 hover:bg-green-700 text-white gap-1 shrink-0"
                                  disabled={editing.isLocked}
                                  onClick={() => handleAddParcelToManifest(p)}>
                                  <Plus className="h-3 w-3" /> Add
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* AWBs table */}
                      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="bg-slate-800 px-4 py-2.5 flex items-center justify-between gap-3">
                          <span className="text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                            <Package className="h-3.5 w-3.5 text-orange-400" /> AWBs in this Manifest
                            <span className="bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{editing.parcels.length}</span>
                          </span>
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                            <input value={awbSearch} onChange={(e) => setAwbSearch(e.target.value)}
                              placeholder="Search AWB…" className="pl-6 h-6 text-xs bg-white/10 border border-white/20 rounded text-white placeholder-slate-400 focus:outline-none focus:border-white/40 w-40" />
                          </div>
                        </div>
                        <div className="overflow-x-auto max-h-56">
                          <table className="w-full text-xs min-w-[640px]">
                            <thead className="sticky top-0 z-10">
                              <tr className="bg-slate-50 border-b border-slate-100">
                                {["#","Tracking ID","Shipper","Receiver","Route","Pkgs","Weight","Status"].map(h => (
                                  <th key={h} className="px-3 py-2 text-left font-bold text-blue-700 uppercase tracking-wide text-[10px]">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {filteredAwbs.map((p, idx) => (
                                <tr key={p.id || idx} className={idx % 2 === 0 ? "bg-white" : "bg-slate-50/30"}>
                                  <td className="px-3 py-2 text-slate-400 font-mono">{idx + 1}</td>
                                  <td className="px-3 py-2 font-mono font-bold text-blue-600">{p.tracking_id}</td>
                                  <td className="px-3 py-2 text-slate-700">{p.sender_name}</td>
                                  <td className="px-3 py-2 text-slate-700">{p.receiver_name}</td>
                                  <td className="px-3 py-2 text-slate-500">
                                    {countryMap[p.from_country] || p.from_country} → {countryMap[p.to_country] || p.to_country}
                                  </td>
                                  <td className="px-3 py-2 font-semibold">{p.pieces ?? 1}</td>
                                  <td className="px-3 py-2 font-semibold">{p.weight} kg</td>
                                  <td className="px-3 py-2">
                                    <ManifestStatusBadge status={p.current_status} size="xs" />
                                  </td>
                                </tr>
                              ))}
                              {filteredAwbs.length === 0 && (
                                <tr>
                                  <td colSpan={8} className="px-3 py-8 text-center text-slate-400 text-xs">
                                    {awbSearch ? "No AWBs match search" : "No AWBs in this manifest"}
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Bottom action bar */}
                      <div className="bg-slate-900 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                          <input placeholder="Search AWB…" value={awbSearch} onChange={(e) => setAwbSearch(e.target.value)}
                            className="pl-8 h-8 text-xs bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 w-36" />
                        </div>

                        <Button size="sm" className="h-8 text-xs bg-blue-700 hover:bg-blue-800 text-white gap-1.5"
                          onClick={handleSave} disabled={saving || editing.isLocked}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Update Manifest
                        </Button>

                        {/* Bagging button */}
                        <Button size="sm" variant="outline"
                          className="h-8 text-xs border-orange-500 text-orange-400 hover:text-orange-200 hover:bg-orange-500/20 gap-1.5"
                          onClick={() => setShowBagging(true)}>
                          <Box className="h-3.5 w-3.5" /> Bagging
                          {editing.baggingInfo?.bags?.length > 0 && (
                            <span className="bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">
                              {editing.baggingInfo.bags.length}
                            </span>
                          )}
                        </Button>

                        {/* CSV Import section */}
                        <div className="flex items-center gap-2 ml-auto flex-wrap">
                          <span className="text-slate-400 text-xs font-medium">CSV Import <span className="text-red-400">*</span></span>
                          <label className="cursor-pointer">
                            <div className="h-8 px-3 flex items-center gap-2 bg-slate-800 border border-slate-600 rounded text-slate-300 text-xs hover:border-slate-400 transition-colors max-w-[150px]">
                              <span className="truncate">{csvFile?.name || "No file chosen"}</span>
                            </div>
                            <input
                              ref={csvInputRef}
                              type="file"
                              accept=".csv"
                              className="hidden"
                              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                            />
                          </label>
                          <Button size="sm"
                            className={`h-8 text-xs gap-1.5 ${csvFile ? "bg-blue-600 hover:bg-blue-500" : "bg-slate-700 hover:bg-slate-600"} text-white`}
                            disabled={!csvFile || importing || editing.isLocked}
                            onClick={handleCSVImport}>
                            {importing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <UploadCloud className="h-3 w-3" />}
                            {importing ? "Importing…" : "Import"}
                          </Button>
                          <Button size="sm" variant="outline"
                            className="h-8 text-xs border-slate-600 text-slate-300 hover:text-white hover:bg-slate-700 gap-1"
                            onClick={downloadSampleCSV}>
                            <Download className="h-3.5 w-3.5" /> Sample
                          </Button>
                        </div>
                      </div>
                    </TabsContent>

                    {/* ══ TRACKING EVENTS TAB ═══════════════════════════════ */}
                    <TabsContent value="tracking" className="m-0 p-4 space-y-4">
                      <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                        <div className="bg-slate-800 px-4 py-2.5 flex items-center justify-between">
                          <span className="text-white font-bold text-xs uppercase tracking-widest flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5 text-orange-400" /> Tracking Events
                          </span>
                          <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700 text-white gap-1" disabled={editing.isLocked}
                            onClick={() => {
                              const newEvent = { id: Date.now().toString(), awb: "", event: "", location: "", timestamp: new Date().toISOString().slice(0, 16), notes: "" };
                              setEditField("trackingEvents", [...(editing.trackingEvents || []), newEvent]);
                            }}>
                            <Plus className="h-3 w-3" /> Add Event
                          </Button>
                        </div>
                        {(!editing.trackingEvents || editing.trackingEvents.length === 0) ? (
                          <div className="py-12 text-center">
                            <MapPin className="h-8 w-8 text-slate-200 mx-auto mb-2" />
                            <p className="text-sm text-slate-500">No tracking events yet</p>
                            <p className="text-xs text-slate-400 mt-1">Click "Add Event" to add a tracking update for AWBs in this manifest</p>
                          </div>
                        ) : (
                          <div className="divide-y divide-slate-50">
                            {editing.trackingEvents.map((ev, i) => (
                              <div key={ev.id} className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end hover:bg-slate-50/50">
                                <div className="space-y-1">
                                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">AWB / Tracking ID</Label>
                                  <Input value={ev.awb} placeholder="AWB number" className="h-8 text-sm" disabled={editing.isLocked}
                                    onChange={(e) => {
                                      const evs = [...editing.trackingEvents];
                                      evs[i] = { ...evs[i], awb: e.target.value };
                                      setEditField("trackingEvents", evs);
                                    }} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">Event</Label>
                                  <Input value={ev.event} placeholder="e.g. In Transit" className="h-8 text-sm" disabled={editing.isLocked}
                                    onChange={(e) => {
                                      const evs = [...editing.trackingEvents];
                                      evs[i] = { ...evs[i], event: e.target.value };
                                      setEditField("trackingEvents", evs);
                                    }} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">Location</Label>
                                  <Input value={ev.location} placeholder="City / Hub" className="h-8 text-sm" disabled={editing.isLocked}
                                    onChange={(e) => {
                                      const evs = [...editing.trackingEvents];
                                      evs[i] = { ...evs[i], location: e.target.value };
                                      setEditField("trackingEvents", evs);
                                    }} />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">Timestamp</Label>
                                  <Input type="datetime-local" value={ev.timestamp} className="h-8 text-sm" disabled={editing.isLocked}
                                    onChange={(e) => {
                                      const evs = [...editing.trackingEvents];
                                      evs[i] = { ...evs[i], timestamp: e.target.value };
                                      setEditField("trackingEvents", evs);
                                    }} />
                                </div>
                                <Button variant="ghost" size="sm" className="h-8 text-red-400 hover:text-red-600 hover:bg-red-50 self-end" disabled={editing.isLocked}
                                  onClick={() => setEditField("trackingEvents", editing.trackingEvents.filter((_, idx) => idx !== i))}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    {/* ══ BILLING TAB ════════════════════════════════════════ */}
                    <TabsContent value="billing" className="m-0 p-4 space-y-4">
                      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 space-y-4">
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-1.5 flex items-center gap-2">
                          <DollarSign className="h-3.5 w-3.5 text-blue-600" /> Billing Summary
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                          {[
                            { label: "Total AWBs",       value: String(computedAwb) },
                            { label: "Total Pieces",      value: String(computedPcs) },
                            { label: "Total Actual Wt",  value: `${computedActual} kg` },
                            { label: "Total Volumetric", value: `${editing.totalVolumetricWt ?? 0} kg` },
                            { label: "Total Chargeable", value: `${editing.totalVolumetricWt && Number(editing.totalVolumetricWt) > Number(computedActual) ? editing.totalVolumetricWt : computedActual} kg` },
                            { label: "Total Value",      value: `${editing.currency} ${editing.totalValue.toFixed(2)}` },
                          ].map(({ label, value }) => (
                            <div key={label} className="bg-slate-50 rounded-xl border border-slate-100 p-3">
                              <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">{label}</p>
                              <p className="text-lg font-bold text-slate-800 mt-1">{value}</p>
                            </div>
                          ))}
                        </div>
                        <Separator />
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-100">
                                {["#","Tracking ID","Shipper","Weight","Value","Service","Chargeable"].map(h => (
                                  <th key={h} className="px-3 py-2 text-left text-[11px] font-bold text-blue-700 uppercase tracking-wide">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {editing.parcels.map((p, i) => (
                                <tr key={p.id || i} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/30"}>
                                  <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                                  <td className="px-3 py-2 font-mono text-xs font-bold text-blue-600">{p.tracking_id}</td>
                                  <td className="px-3 py-2 text-xs text-slate-700">{p.sender_name}</td>
                                  <td className="px-3 py-2 text-xs font-semibold">{p.weight} kg</td>
                                  <td className="px-3 py-2 text-xs font-semibold">{p.currency} {Number(p.total_price).toFixed(2)}</td>
                                  <td className="px-3 py-2 text-xs">{p.service_type || "—"}</td>
                                  <td className="px-3 py-2 text-xs font-bold text-blue-700">{p.weight} kg</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="bg-gradient-to-r from-orange-500 to-orange-600">
                                <td className="px-3 py-2 text-white font-bold text-xs" colSpan={3}>TOTALS</td>
                                <td className="px-3 py-2 text-white font-bold text-xs">{computedActual} kg</td>
                                <td className="px-3 py-2 text-white font-bold text-xs">{editing.currency} {editing.totalValue.toFixed(2)}</td>
                                <td></td>
                                <td className="px-3 py-2 text-white font-bold text-xs">{computedActual} kg</td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      </div>
                    </TabsContent>

                  </div>{/* end scrollable */}
                </Tabs>
              </div>
            </>
          </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Bagging Dialog ────────────────────────────────────────────────────── */}
      {editing && (
        <BaggingDialog
          open={showBagging}
          onClose={() => setShowBagging(false)}
          initialData={editing.baggingInfo}
          disabled={editing.isLocked}
          onSave={(data) => {
            setEditField("baggingInfo", data);
            toast({ title: "Bagging info saved ✓", description: `${data.bags.length} bag type(s) recorded. Click Update Manifest.` });
          }}
        />
      )}

      {/* ── Manifest History Dialog ───────────────────────────────────────────── */}
      {editing && (
        <ManifestHistoryDialog
          open={showHistory}
          onClose={() => setShowHistory(false)}
          manifestId={editing.manifestId}
        />
      )}

      {/* ── Find Parcel by Ref ID → New Manifest Dialog ───────────────────────── */}
      <Dialog open={showFindParcelDialog} onOpenChange={setShowFindParcelDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="h-5 w-5 text-blue-600" />
              Find Parcel by Reference ID
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500">
            Search any parcel by its Reference ID or Tracking ID. If it isn't already part of a
            manifest, you can spin up a new manifest for it right here.
          </p>
          <div className="flex gap-2">
            <Input
              autoFocus
              value={findParcelQuery}
              onChange={(e) => setFindParcelQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleFindParcelSearch(); } }}
              placeholder="Reference ID or Tracking ID…"
              className="h-9 text-sm"
            />
            <Button size="sm" className="h-9 bg-blue-600 hover:bg-blue-700 text-white gap-1.5"
              disabled={findingParcel || !findParcelQuery.trim()} onClick={handleFindParcelSearch}>
              {findingParcel ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              Search
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2">
            {findParcelResults.length === 0 && !findingParcel && (
              <p className="text-xs text-slate-400 text-center py-6">No results yet — try a search above.</p>
            )}
            {findParcelResults.map((p) => (
              <div key={p.id || p.tracking_id} className="border border-slate-100 rounded-lg p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-blue-600 text-sm">{p.tracking_id}</span>
                    {p.reference_id && <Badge variant="outline" className="text-[10px]">Ref: {p.reference_id}</Badge>}
                  </div>
                  <p className="text-xs text-slate-600 truncate mt-0.5">
                    {p.sender_name || "—"} → {p.receiver_name || "—"} · {p.weight ?? 0} kg · {p.from_country || "—"} → {p.to_country || "—"}
                  </p>
                </div>
                <Button size="sm" className="h-8 text-xs bg-green-600 hover:bg-green-700 text-white gap-1.5 shrink-0"
                  disabled={creatingManifestFor === (p.id || p.tracking_id)}
                  onClick={() => handleCreateManifestFromParcel(p)}>
                  {creatingManifestFor === (p.id || p.tracking_id)
                    ? <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                    : <Plus className="h-3.5 w-3.5" />}
                  Create Manifest
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Single Status Update Dialog (with comment) ────────────────────────── */}
      <Dialog open={singleStatusDialog.open} onOpenChange={(o) => { if (!o) setSingleStatusDialog({ open: false, manifestId: "", status: "", comment: "" }); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-5 w-5 text-blue-600" />
              Update Status
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              Set <strong>{singleStatusDialog.manifestId}</strong> to:
            </p>
            {singleStatusDialog.status && (
              <div className="flex justify-center">
                <ManifestStatusBadge status={singleStatusDialog.status} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                Comment <span className="text-slate-400 font-normal normal-case">(optional — shown on public tracking)</span>
              </Label>
              <Textarea
                value={singleStatusDialog.comment}
                onChange={(e) => setSingleStatusDialog((d) => ({ ...d, comment: e.target.value }))}
                placeholder="e.g. Held for additional customs documentation"
                rows={3}
                className="text-sm resize-none"
              />
            </div>
            <p className="text-xs text-slate-500">This updates the manifest and every parcel inside it.</p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" size="sm" onClick={() => setSingleStatusDialog({ open: false, manifestId: "", status: "", comment: "" })}>Cancel</Button>
              <Button size="sm" className="bg-blue-700 hover:bg-blue-800 text-white gap-1.5" onClick={confirmSingleStatus}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Apply
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Bulk Status Confirm Dialog ────────────────────────────────────────── */}
      <Dialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-blue-600" />
              Bulk Status Update
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-slate-600">
              Update <strong>{selectedIds.size}</strong> selected manifest{selectedIds.size > 1 ? "s" : ""} to:
            </p>
            {bulkStatus && (
              <div className="flex justify-center">
                <ManifestStatusBadge status={bulkStatus} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                Comment <span className="text-slate-400 font-normal normal-case">(optional — shown on public tracking)</span>
              </Label>
              <Textarea
                value={bulkComment}
                onChange={(e) => setBulkComment(e.target.value)}
                placeholder="e.g. Delayed due to weather at origin hub"
                rows={3}
                className="text-sm resize-none"
              />
            </div>
            <p className="text-xs text-slate-500 text-center">This will overwrite the current status of all selected manifests.</p>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" size="sm" onClick={() => setShowBulkDialog(false)}>Cancel</Button>
              <Button size="sm" className="bg-blue-700 hover:bg-blue-800 text-white gap-1.5" onClick={handleBulkStatusApply}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Apply to {selectedIds.size} Manifest{selectedIds.size > 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create Manifest — Step 1: Add Parcels by Reference ID ──────────── */}
      {/* Multi-add workflow: enter a Reference ID (or Tracking ID), click "Add" */}
      {/* to queue it, then add another. Once done, click "Generate Manifest" */}
      {/* to move to Step 2 where manifest-level fields are captured. */}
      <Dialog open={showCreateManifestDialog} onOpenChange={(o) => { if (!o) resetCreateManifest(); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-blue-600" />
              Create Manifest — Add Parcels
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500">
            Enter a <strong>Reference ID</strong> or <strong>Tracking ID</strong> and click <strong>Add</strong> to queue a parcel.
            You can add multiple parcels at the same time before generating the manifest.
          </p>

          {/* Input + Add button */}
          <div className="flex gap-2">
            <Input
              autoFocus
              value={refIdInput}
              onChange={(e) => setRefIdInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddPendingParcel(); } }}
              placeholder="Reference ID or Tracking ID…"
              className="h-9 text-sm"
              disabled={searchingPending}
            />
            <Button
              size="sm"
              className="h-9 px-4 bg-blue-600 hover:bg-blue-700 text-white gap-1.5 shrink-0"
              disabled={searchingPending || !refIdInput.trim()}
              onClick={handleAddPendingParcel}
            >
              {searchingPending ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add
            </Button>
          </div>

          {/* Pending parcels list */}
          <div className="flex-1 overflow-y-auto space-y-2 min-h-[120px]">
            {pendingParcels.length === 0 && !searchingPending && (
              <div className="flex flex-col items-center justify-center py-8 text-center gap-1">
                <Package className="h-8 w-8 text-slate-200" />
                <p className="text-xs text-slate-400">No parcels added yet — enter a Reference ID above to start.</p>
              </div>
            )}
            {pendingParcels.map((p) => (
              <div key={p.id || p.tracking_id} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3 bg-white">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-bold text-blue-600 text-sm">{p.tracking_id}</span>
                    {p.reference_id && <Badge variant="outline" className="text-[10px]">Ref: {p.reference_id}</Badge>}
                    <Badge variant="secondary" className="text-[10px] bg-orange-50 text-orange-700 border-orange-100">
                      {p.weight ?? 0} kg
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-600 truncate mt-0.5">
                    {p.sender_name || "—"} → {p.receiver_name || "—"} · {p.from_country || "—"} → {p.to_country || "—"}
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                  onClick={() => removePendingParcel(p.tracking_id)}
                  title="Remove from list">
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* Summary + actions */}
          <div className="border-t border-slate-100 pt-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-blue-100 text-blue-700 border-blue-200">
                {pendingParcels.length} parcel{pendingParcels.length !== 1 ? "s" : ""}
              </Badge>
              {pendingParcels.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {pendingParcels.reduce((s, p) => s + Number(p.weight || 0), 0).toFixed(2)} kg total
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={resetCreateManifest}>Cancel</Button>
              <Button
                size="sm"
                disabled={pendingParcels.length === 0}
                onClick={() => setShowManifestFieldsDialog(true)}
                className="gap-1.5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white"
              >
                <FileText className="h-3.5 w-3.5" />
                Generate Manifest
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create Manifest — Step 2: Manifest Details (other features) ─────── */}
      {/* After "Generate Manifest" is clicked in Step 1, this dialog asks for the */}
      {/* remaining manifest-level fields (origin/dest hub, flight, service, …) */}
      {/* before the manifest is actually created. */}
      <Dialog open={showManifestFieldsDialog} onOpenChange={(o) => { if (!o) setShowManifestFieldsDialog(false); }}>
        <DialogContent className="max-w-4xl max-h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Manifest Details
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-500">
            Fill in the manifest-level details below. The {pendingParcels.length} parcel{pendingParcels.length !== 1 ? "s" : ""} you added
            will be attached automatically. Click <strong>Create Manifest</strong> when done.
          </p>

          <div className="flex-1 overflow-y-auto pr-1">
            <div className="grid md:grid-cols-3 gap-4">
              {/* LEFT — Manifest Info */}
              <div className="space-y-3 bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-1.5">Manifest Info</p>
                <Field label="Booking From Date" type="date" value={manifestDraft.bookingFromDate}
                  onChange={(v) => setManifestDraft((d) => ({ ...d, bookingFromDate: v }))} />
                <Field label="Booking Till Date" type="date" value={manifestDraft.bookingTillDate}
                  onChange={(v) => setManifestDraft((d) => ({ ...d, bookingTillDate: v }))} />
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Forwarder</Label>
                  <Input value={manifestDraft.forwarder} onChange={(e) => setManifestDraft((d) => ({ ...d, forwarder: e.target.value }))}
                    placeholder="Forwarder name" className="h-8 text-sm border-slate-200" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Service</Label>
                  <Select value={manifestDraft.service} onValueChange={(v) => setManifestDraft((d) => ({ ...d, service: v }))}>
                    <SelectTrigger className="h-8 text-sm border-slate-200">
                      <SelectValue placeholder="Select service" />
                    </SelectTrigger>
                    <SelectContent>
                      {SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Field label="Master No." value={manifestDraft.masterNo}
                  onChange={(v) => setManifestDraft((d) => ({ ...d, masterNo: v }))} />
                <Field label="Master EDI Bag No" value={manifestDraft.masterEdiBagNo}
                  onChange={(v) => setManifestDraft((d) => ({ ...d, masterEdiBagNo: v }))} />
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Remark</Label>
                  <Textarea value={manifestDraft.remark} onChange={(e) => setManifestDraft((d) => ({ ...d, remark: e.target.value }))}
                    placeholder="Any remarks…" rows={2} className="text-sm border-slate-200 resize-none" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">License</Label>
                  <select
                    value={manifestDraft.license}
                    onChange={(e) => setManifestDraft((d) => ({ ...d, license: e.target.value }))}
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">— Select license —</option>
                    {licenses.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                </div>
              </div>

              {/* MIDDLE — Flight & Shipment */}
              <div className="space-y-3 bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-1.5">Flight & Shipment</p>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Date" type="date" value={manifestDraft.manifestDate}
                    onChange={(v) => setManifestDraft((d) => ({ ...d, manifestDate: v }))} />
                  <Field label="Time" type="time" value={manifestDraft.manifestTime}
                    onChange={(v) => setManifestDraft((d) => ({ ...d, manifestTime: v }))} />
                </div>
                <Field label="Run Number" value={manifestDraft.runNumber}
                  onChange={(v) => setManifestDraft((d) => ({ ...d, runNumber: v }))} />
                <Field label="Flight No" value={manifestDraft.flightNo} placeholder="e.g. PK-301"
                  onChange={(v) => setManifestDraft((d) => ({ ...d, flightNo: v }))} />
                <Field label="No. of Bags" type="number" value={manifestDraft.noOfBags}
                  onChange={(v) => setManifestDraft((d) => ({ ...d, noOfBags: v ? Number(v) : "" }))} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Arrival Date" type="date" value={manifestDraft.arrivalDate}
                    onChange={(v) => setManifestDraft((d) => ({ ...d, arrivalDate: v }))} />
                  <Field label="Arrival Time" type="time" value={manifestDraft.arrivalTime}
                    onChange={(v) => setManifestDraft((d) => ({ ...d, arrivalTime: v }))} />
                </div>
                <Field label="Company" value={manifestDraft.company}
                  onChange={(v) => setManifestDraft((d) => ({ ...d, company: v }))} />
                <Separator className="my-1" />
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Weight Summary</p>
                <Field label="Vendor Weight (kg)" type="number" value={manifestDraft.vendorWeight}
                  onChange={(v) => setManifestDraft((d) => ({ ...d, vendorWeight: v ? Number(v) : "" }))} />
                <Field label="Total Volumetric Wt (kg)" type="number" value={manifestDraft.totalVolumetricWt}
                  onChange={(v) => setManifestDraft((d) => ({ ...d, totalVolumetricWt: v ? Number(v) : "" }))} />
                <div className="grid grid-cols-2 gap-3">
                  <Field label="No. of AWB" value={pendingParcels.length} readOnly />
                  <Field label="Total Weight (kg)"
                    value={pendingParcels.reduce((s, p) => s + Number(p.weight || 0), 0).toFixed(2)} readOnly />
                </div>
              </div>

              {/* RIGHT — Hubs & Route */}
              <div className="space-y-3 bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-100 pb-1.5">Hubs & Route</p>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                    Origin Hub <span className="text-red-500">*</span>
                  </Label>
                  <SearchableSelect
                    value={manifestDraft.originHub}
                    onChange={(v) => setManifestDraft((d) => ({ ...d, originHub: v }))}
                    options={ORIGIN_HUBS}
                    placeholder="Search origin hub…"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">
                    Destination Hub <span className="text-slate-400 font-normal normal-case">(worldwide)</span>
                  </Label>
                  <SearchableSelect
                    value={manifestDraft.destinationHub}
                    onChange={(v) => setManifestDraft((d) => ({ ...d, destinationHub: v }))}
                    options={DEST_HUBS}
                    placeholder="Search destination worldwide…"
                  />
                </div>

                {/* Route summary */}
                <div className="bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl border border-blue-100 p-3 space-y-2">
                  <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Route Preview</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] text-slate-500">FROM</p>
                      <p className="text-sm font-bold text-slate-800 truncate">{manifestDraft.originHub || "—"}</p>
                    </div>
                    <Plane className="h-4 w-4 text-orange-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-[10px] text-slate-500">TO</p>
                      <p className="text-sm font-bold text-slate-800 truncate">{manifestDraft.destinationHub || "—"}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {pendingParcels.length} parcel{pendingParcels.length !== 1 ? "s" : ""} queued ·
              {" "}{pendingParcels.reduce((s, p) => s + Number(p.weight || 0), 0).toFixed(2)} kg total
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowManifestFieldsDialog(false)}>Back</Button>
              <Button
                size="sm"
                disabled={generating}
                onClick={handleGenerateManifest}
                className="gap-1.5 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white"
              >
                {generating ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Create Manifest
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>


    </div>
  );
};
