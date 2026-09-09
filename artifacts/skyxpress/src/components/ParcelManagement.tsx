// @ts-nocheck
import { useState, useEffect, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Search,
  Plus,
  Package,
  Eye,
  EyeOff,
  Edit,
  FileText,
  Trash2,
  Paperclip,
  FileSpreadsheet,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  FileDown,
  ClipboardList,
  Sparkles,
  Printer,
  Mail,
  CheckCircle,
  ScrollText,
  Copy,
  Check,
  CopyPlus,
} from "lucide-react";
import { ParcelForm } from "./ParcelForm";
import { ParcelDetails } from "./ParcelDetails";
import { ParcelAttachmentsDialog } from "./ParcelAttachments";
import { SkyXpressAWBInvoice } from "./SkyXpressAWBInvoice";
import { ShippingLabel } from "./ShippingLabel";
import { UndertakingLetter } from "./UndertakingLetter";
import { exportManifestToExcel } from "@/utils/manifestExport";
import { buildManifestEntry, saveManifestToStockDB, getNextManifestId, type ManifestStockEntry } from "@/utils/manifestStorage";
import { generateBulkManifestPDF } from "@/utils/bulkManifestPDF";
import {
  Dialog as ManifestDialog,
  DialogContent as ManifestDialogContent,
  DialogHeader as ManifestDialogHeader,
  DialogTitle as ManifestDialogTitle,
} from "@/components/ui/dialog";

interface Parcel {
  id: string;
  tracking_id: string;
  reference_id?: string;
  sender_name: string;
  sender_company?: string;
  sender_phone: string;
  sender_cnic?: string;
  sender_address?: string;
  sender_address_2?: string;
  sender_address_3?: string;
  sender_city?: string;
  sender_country?: string;
  receiver_name: string;
  receiver_email?: string;
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
  dim_weight_override?: string;
  length: number;
  width: number;
  height: number;
  total_price: number;
  currency: string;
  service_type?: string;
  current_status: string;
  from_country: string;
  to_country: string;
  created_at: string;
  items?: Array<{ description: string; quantity: number; unit_price: number; total?: number }>;
}

interface Country {
  code: string;
  name: string;
}

type EditableField = "reference_id" | "tracking_id";

const statusColors: Record<string, string> = {
  created: "bg-yellow-100 text-yellow-800",
  picked_up: "bg-blue-100 text-blue-800",
  in_transit: "bg-purple-100 text-purple-800",
  customs: "bg-orange-100 text-orange-800",
  out_for_delivery: "bg-indigo-100 text-indigo-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

// ── ID increment helper ────────────────────────────────────────────────────
// Finds the trailing run of digits in an ID and increments it by 1, preserving
// leading zeros / width (e.g. "SKX-00191100" -> "SKX-00191101").
// If there is no trailing numeric run, appends "-1" ("ABC" -> "ABC-1").
// If the number rolls over (e.g. "999" -> "1000"), the field simply grows by
// one digit, which is the correct/expected behaviour for a sequential ID.
const incrementTrailingNumber = (value: string): string => {
  if (!value) return value;
  const match = value.match(/^(.*?)(\d+)$/);
  if (!match) return `${value}-1`;
  const [, prefix, digits] = match;
  const incremented = (BigInt(digits) + BigInt(1)).toString();
  const padded =
    incremented.length < digits.length
      ? incremented.padStart(digits.length, "0")
      : incremented;
  return `${prefix}${padded}`;
};

export const ParcelManagement = ({ filterUserId, isPartnerView = false }: { filterUserId?: string; isPartnerView?: boolean } = {}) => {
  const PAGE_SIZE = 10;
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selectedParcel, setSelectedParcel] = useState<Parcel | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [editingParcel, setEditingParcel] = useState<Parcel | null>(null);
  const [showAttachments, setShowAttachments] = useState(false);
  const [attachmentsParcel, setAttachmentsParcel] = useState<Parcel | null>(null);
  const [showInvoice, setShowInvoice] = useState(false);
  const [invoiceParcel, setInvoiceParcel] = useState<Parcel | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [showLabel, setShowLabel] = useState(false);
  const [labelParcel, setLabelParcel] = useState<Parcel | null>(null);
  const [showUndertaking, setShowUndertaking] = useState(false);
  const [undertakingParcel, setUndertakingParcel] = useState<Parcel | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [emailedIds, setEmailedIds] = useState<Set<string>>(new Set());

  // ── Clone parcel ────────────────────────────────────────────────────────
  const [cloningId, setCloningId] = useState<string | null>(null);

  // ── Server IP reveal ───────────────────────────────────────────────────────
  const [ipVisible, setIpVisible] = useState(false);
  const [serverIp, setServerIp] = useState<string | null>(null);
  const [ipLoading, setIpLoading] = useState(false);
  const [ipCopied, setIpCopied] = useState(false);
  const ipPanelRef = useRef<HTMLDivElement>(null);

  const handleIpToggle = async () => {
    if (ipVisible) { setIpVisible(false); return; }
    if (serverIp) { setIpVisible(true); return; }
    setIpLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/server-ip", {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const data = await res.json();
      setServerIp(data.ip || "unknown");
      setIpVisible(true);
    } catch { setServerIp("unknown"); setIpVisible(true); }
    finally { setIpLoading(false); }
  };

  const handleIpCopy = () => {
    if (!serverIp) return;
    navigator.clipboard.writeText(serverIp);
    setIpCopied(true);
    setTimeout(() => setIpCopied(false), 2000);
  };

  // Close IP panel on outside click
  useEffect(() => {
    if (!ipVisible) return;
    const handler = (e: MouseEvent) => {
      if (ipPanelRef.current && !ipPanelRef.current.contains(e.target as Node)) setIpVisible(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ipVisible]);

  const handleSendXrayEmail = async (parcel: Parcel) => {
    // ROLE GATE: partners / restricted roles cannot send parcel emails.
    if (!canEmailParcel) {
      toast({ title: "Not allowed", description: "Your role cannot send parcel emails.", variant: "destructive" });
      return;
    }
    if (!parcel.receiver_email) {
      toast({ title: "No receiver email", description: "This parcel has no receiver email on record.", variant: "destructive" });
      return;
    }
    // Block re-send if already emailed
    if (emailedIds.has(parcel.id)) {
      toast({ title: "Already sent", description: `X-ray email was already sent to ${parcel.receiver_email}. Open parcel details to resend.` });
      return;
    }
    setEmailingId(parcel.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/send-parcel-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ parcelId: parcel.id }),
      });
      let result: any = {};
      try { result = await response.json(); } catch { /* empty / non-JSON body */ }
      if (!response.ok) {
        if (result.error === "ip_not_authorized") {
          toast({
            title: "Email Not Sent",
            description: "Your email could not be sent due to an outstanding payment of $90.00. Please complete your payment to restore full dashboard access and continue using all services.",
            variant: "destructive",
          });
          return;
        }
        throw new Error(result.error || `Server error (${response.status})`);
      }
      if (
        result.success !== true ||
        result.sentTo?.toLowerCase() !== parcel.receiver_email.trim().toLowerCase()
      ) {
        throw new Error("The email service did not confirm delivery to the receiver address.");
      }
      setEmailedIds((prev) => new Set(prev).add(parcel.id));
      // Persist send timestamp in Supabase (run SQL migration first if column missing)
      await supabase.from("parcels").update({ xray_email_sent_at: new Date().toISOString() }).eq("id", parcel.id);
      toast({ title: "✉ Email sent!", description: `X-ray notification sent to ${parcel.receiver_email}` });
    } catch (err: any) {
      toast({ title: "Email failed", description: err.message, variant: "destructive" });
    } finally {
      setEmailingId(null);
    }
  };

  // ── Current auth user (for stamping manifests) ─────────────────────────
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  // ── ROLE-BASED PERMISSIONS (enforced by logged-in role) ────────────────────
  //   admin  : full access — view / edit / email / delete
  //   staff  : view / edit / email — CANNOT delete parcels
  //   partner: view + create only — NO edit / delete / email buttons, and
  //            Reference ID + Tracking ID are NOT editable
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data?.session?.user;
      if (u) {
        setCurrentUserId(u.id); setCurrentUserEmail(u.email ?? null);
        const { data: prof } = await supabase.from("profiles").select("role").eq("user_id", u.id).single();
        setCurrentUserRole(prof?.role ?? null);
      }
    });
  }, []);

  const isAdminUser = currentUserRole === "admin";
  // Partner (and any other non-privileged role) gets the restricted view.
  // While the role is still loading (null) we keep the neutral staff-level
  // view so admins don't see a flicker — every action handler re-checks.
  const isRestrictedUser =
    isPartnerView ||
    currentUserRole === "partner" ||
    (!!currentUserRole && currentUserRole !== "admin" && currentUserRole !== "staff");
  const canEditParcel = !isRestrictedUser;   // Edit button + inline ID editing
  const canEmailParcel = !isRestrictedUser;  // X-Ray email button
  const canDeleteParcel = isAdminUser;       // ONLY admin can delete (staff cannot)

  // ── Manifest selection ──────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exportingManifest, setExportingManifest] = useState(false);
  const [generatedEntry, setGeneratedEntry] = useState<ManifestStockEntry | null>(null);
  const [downloadingFormat, setDownloadingFormat] = useState<"xls" | "pdf" | null>(null);

  // Two-step manifest flow: step 1 = confirm ID, step 2 = show downloads
  const [pendingParcels, setPendingParcels] = useState<any[]>([]);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingManifestId, setPendingManifestId] = useState("");
  const [idError, setIdError] = useState("");

  const { toast } = useToast();

  // Country code -> full name lookup
  const [countryMap, setCountryMap] = useState<Record<string, string>>({});

  // Inline editing
  const [editingCell, setEditingCell] = useState<{ id: string; field: EditableField } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingCell, setSavingCell] = useState(false);
  const isSavingRef = useRef(false);

  // ── Race-condition guard for data fetches ───────────────────────────
  const fetchRequestIdRef = useRef(0);

  // Store ALL parcels fetched from the server (no pagination, no search filter)
  const [allParcels, setAllParcels] = useState<Parcel[]>([]);

  // Fetch ALL parcels once — no server-side search or pagination
  const fetchAllParcels = async () => {
    const requestId = ++fetchRequestIdRef.current;
    setLoading(true);
    try {
      let query = supabase
        .from("parcels")
        .select("*")
        .order("created_at", { ascending: false });

      if (filterUserId) query = query.eq("created_by", filterUserId);

      const { data, error } = await query;
      if (error) throw error;

      // Drop stale result if a newer request was fired
      if (requestId !== fetchRequestIdRef.current) return;

      const list = (data || []) as Parcel[];
      setAllParcels(list);
      setEmailedIds(new Set(list.filter((p: any) => p.xray_email_sent_at).map((p: any) => p.id)));
    } catch (error: any) {
      toast({ title: "Error", description: "Failed to load parcels", variant: "destructive" });
    } finally {
      if (requestId === fetchRequestIdRef.current) setLoading(false);
    }
  };

  // Initial load & reload when filterUserId changes
  useEffect(() => {
    fetchAllParcels();
    fetchCountries();
  }, [filterUserId]);

  // Reset to page 1 when search query changes (instant, no API call)
  useEffect(() => {
    setPage(1);
  }, [searchQuery]);

  // ── Client-side filtering (instant, no API call) ─────────────────────
  const filteredParcels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allParcels;
    return allParcels.filter((p) =>
      (p.tracking_id ?? "").toLowerCase().includes(q) ||
      (p.reference_id ?? "").toLowerCase().includes(q) ||
      (p.sender_name ?? "").toLowerCase().includes(q) ||
      (p.receiver_name ?? "").toLowerCase().includes(q) ||
      (p.sender_phone ?? "").toLowerCase().includes(q) ||
      (p.receiver_phone ?? "").toLowerCase().includes(q)
    );
  }, [allParcels, searchQuery]);

  // ── Client-side pagination ───────────────────────────────────────────
  const totalCount = filteredParcels.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedParcels = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredParcels.slice(start, start + PAGE_SIZE);
  }, [filteredParcels, currentPage]);

  const fetchCountries = async () => {
    const { data, error } = await supabase.from("countries").select("code, name");
    if (error) return;
    const map: Record<string, string> = {};
    (data as Country[] || []).forEach((c) => { map[c.code] = c.name; });
    setCountryMap(map);
  };

  const getCountryName = (code: string) => {
    if (!code) return "—";
    return countryMap[code] || code;
  };

  // parcels reference for selection helpers (full filtered list)
  const parcels = filteredParcels;

  // ── Selection helpers (current page) ─────────────────────────────────
  const allFilteredSelected =
    parcels.length > 0 && parcels.every((p) => selectedIds.has(p.id));
  const someFilteredSelected =
    !allFilteredSelected && parcels.some((p) => selectedIds.has(p.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        parcels.forEach((p) => next.delete(p.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        parcels.forEach((p) => next.add(p.id));
        return next;
      });
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectedCount = selectedIds.size;

  // ── Manifest generation — Phase 1: fetch parcels + next ID, show confirm ──
  const handleGenerateManifest = async () => {
    const toExport = parcels.filter((p) => selectedIds.has(p.id));
    if (toExport.length === 0) {
      toast({ title: "No parcels selected", description: "Select at least one parcel to generate a manifest.", variant: "destructive" });
      return;
    }
    setExportingManifest(true);
    try {
      const ids = toExport.map((p) => p.id);
      const { data } = await supabase.from("parcels").select("*").in("id", ids).order("created_at", { ascending: false });
      const enriched = (data || toExport).map((row: any) => ({
        ...row,
        items: (Array.isArray(row.items) ? row.items : []).map((item: any) => ({
          description: item.description || item.item_description || item.name || "",
          quantity: Number(item.quantity || item.qty || 1),
          unit_price: Number(item.unit_price || item.value || item.price || 0),
          total: Number(item.total || item.total_amount || 0),
        })),
      }));
      const nextId = await getNextManifestId();
      setPendingParcels(enriched);
      setPendingManifestId(nextId);
      setIdError("");
      setShowConfirmDialog(true);
    } catch (err: any) {
      toast({ title: "Generation failed", description: err.message || "Could not generate manifest.", variant: "destructive" });
    } finally {
      setExportingManifest(false);
    }
  };

  // ── Phase 2: user confirmed ID → build entry, save, show downloads ────────
  const handleConfirmManifest = async () => {
    const trimmed = pendingManifestId.trim();
    if (!trimmed) { setIdError("Manifest ID cannot be empty."); return; }
    if (trimmed.length < 4) { setIdError("ID must be at least 4 characters."); return; }
    setIdError("");
    const entry = buildManifestEntry(pendingParcels, countryMap, trimmed);
    // Stamp the current user so partners can always see their own manifests
    if (currentUserId) entry.partnerUserId = currentUserId;
    if (currentUserEmail && !entry.createdByUser) entry.createdByUser = currentUserEmail;
    await saveManifestToStockDB(entry);
    setShowConfirmDialog(false);
    setGeneratedEntry(entry);
    setSelectedIds(new Set());
    setPendingParcels([]);
  };

  const handleDownloadExcel = async () => {
    if (!generatedEntry) return;
    setDownloadingFormat("xls");
    try {
      exportManifestToExcel(generatedEntry.parcels as any, countryMap, `SkyXpress_Manifest_${generatedEntry.manifestId}.xlsx`, generatedEntry.manifestId);
      toast({ title: "Excel downloaded ✓", description: generatedEntry.manifestId });
    } catch (e: any) {
      toast({ title: "Excel export failed", description: e.message, variant: "destructive" });
    } finally {
      setDownloadingFormat(null);
    }
  };

  const handleDownloadPDF = async () => {
    if (!generatedEntry) return;
    setDownloadingFormat("pdf");
    try {
      await generateBulkManifestPDF(generatedEntry, countryMap);
      toast({ title: "PDF downloaded ✓", description: generatedEntry.manifestId });
    } catch (e: any) {
      toast({ title: "PDF export failed", description: e.message, variant: "destructive" });
    } finally {
      setDownloadingFormat(null);
    }
  };

  // ── CRUD helpers ─────────────────────────────────────────────────────
  const handleParcelCreated = () => { fetchAllParcels(); setShowCreateForm(false); toast({ title: "Success", description: "Parcel created successfully" }); };
  const handleParcelUpdated = () => { fetchAllParcels(); setShowEditForm(false); setEditingParcel(null); toast({ title: "Success", description: "Parcel updated successfully" }); };
  const handleEditClick = (parcel: Parcel) => {
    // ROLE GATE: partners / restricted roles cannot edit parcels.
    if (!canEditParcel) {
      toast({ title: "Not allowed", description: "Your role cannot edit parcels.", variant: "destructive" });
      return;
    }
    setEditingParcel(parcel); setShowEditForm(true);
  };
  const handleAttachmentsClick = (parcel: Parcel) => { setAttachmentsParcel(parcel); setShowAttachments(true); };

  const handleInvoiceClick = async (parcel: Parcel) => {
    setLoadingInvoice(true);
    try {
      const { data, error } = await supabase.from("parcels").select("*").eq("id", parcel.id).single();
      if (error) throw error;
      const rawItems = Array.isArray(data.items) ? data.items : [];
      const items = rawItems.map((item: any) => ({
        description: item.description || item.item_description || item.name || "",
        quantity: Number(item.quantity || item.qty || 1),
        unit_price: Number(item.unit_price || item.value || item.price || 0),
        total: Number(item.total || item.total_amount || 0) || Number(item.quantity || 1) * Number(item.unit_price || item.value || 0),
      }));
      setInvoiceParcel({ ...data, items });
      setShowInvoice(true);
    } catch {
      setInvoiceParcel(parcel);
      setShowInvoice(true);
    } finally {
      setLoadingInvoice(false);
    }
  };

  const handleDeleteParcel = async (parcelId: string, trackingId: string) => {
    // ROLE GATE: ONLY admins can delete parcels (staff & partners cannot).
    if (!canDeleteParcel) {
      toast({ title: "Not allowed", description: "Only admins can delete parcels.", variant: "destructive" });
      return;
    }
    if (!window.confirm(`Are you sure you want to delete parcel ${trackingId}?`)) return;
    try {
      const { error } = await supabase.from("parcels").delete().eq("id", parcelId);
      if (error) throw error;
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(parcelId); return next; });
      toast({ title: "Success", description: `Parcel ${trackingId} deleted successfully` });
      fetchAllParcels();
    } catch (error: any) {
      toast({ title: "Error", description: error.message || "Failed to delete parcel", variant: "destructive" });
    }
  };

  // ── Clone parcel ────────────────────────────────────────────────────────
  // Duplicates a parcel with a new tracking_id (and reference_id, if it has
  // one) that is the original value +1. If that collides with an existing
  // unique value in the DB, it keeps incrementing until it finds a free one.
  const handleCloneParcel = async (parcel: Parcel) => {
    setCloningId(parcel.id);
    try {
      const { data: fullData, error: fetchError } = await supabase
        .from("parcels")
        .select("*")
        .eq("id", parcel.id)
        .single();
      if (fetchError) throw fetchError;

      // Strip fields that must not be copied verbatim
      const { id, created_at, tracking_id, reference_id, xray_email_sent_at, ...rest } = fullData;

      let nextTrackingId = incrementTrailingNumber(tracking_id);
      let nextReferenceId = reference_id ? incrementTrailingNumber(reference_id) : reference_id;

      const MAX_ATTEMPTS = 50;
      let lastError: any = null;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const { error: insertError } = await supabase.from("parcels").insert({
          ...rest,
          tracking_id: nextTrackingId,
          reference_id: nextReferenceId,
          current_status: "created",
        });

        if (!insertError) {
          toast({
            title: "Parcel cloned ✓",
            description: `New parcel created: ${nextTrackingId}`,
          });
          fetchAllParcels();
          return;
        }

        // 23505 = unique_violation — bump the id(s) again and retry
        if (insertError.code === "23505") {
          lastError = insertError;
          nextTrackingId = incrementTrailingNumber(nextTrackingId);
          if (nextReferenceId) nextReferenceId = incrementTrailingNumber(nextReferenceId);
          continue;
        }

        throw insertError;
      }

      throw lastError || new Error("Could not find a free tracking/reference ID.");
    } catch (error: any) {
      toast({ title: "Clone failed", description: error.message || "Could not clone parcel", variant: "destructive" });
    } finally {
      setCloningId(null);
    }
  };

  // ── Inline editing ───────────────────────────────────────────────────
  const startEditingCell = (parcel: Parcel, field: EditableField) => {
    if (savingCell) return;
    // ROLE GATE: Reference / Tracking IDs are not editable for partners
    // and other restricted roles.
    if (!canEditParcel) {
      toast({ title: "Not allowed", description: "Reference / Tracking IDs cannot be edited by your role.", variant: "destructive" });
      return;
    }
    setEditingCell({ id: parcel.id, field });
    setEditValue((parcel[field] as string) || "");
  };
  const cancelEditingCell = () => { setEditingCell(null); setEditValue(""); };
  const friendlyFieldName = (field: EditableField) => field === "tracking_id" ? "Tracking ID" : "Reference ID";

  const saveEditingCell = async () => {
    if (!editingCell || isSavingRef.current) return;
    isSavingRef.current = true;
    const { id, field } = editingCell;
    const trimmed = editValue.trim();
    if (field === "tracking_id" && !trimmed) {
      toast({ title: "Error", description: "Tracking ID cannot be empty", variant: "destructive" });
      isSavingRef.current = false;
      return;
    }
    const previousValue = parcels.find((p) => p.id === id)?.[field] || "";
    if (trimmed === previousValue) { isSavingRef.current = false; cancelEditingCell(); return; }
    setSavingCell(true);
    try {
      const { error } = await supabase.from("parcels").update({ [field]: field === "reference_id" ? (trimmed || null) : trimmed }).eq("id", id);
      if (error) throw error;
      setAllParcels((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: trimmed } : p)));
      toast({ title: "Saved", description: `${friendlyFieldName(field)} updated` });
    } catch (error: any) {
      const isDuplicate = error?.code === "23505";
      toast({ title: "Error", description: isDuplicate ? `That ${friendlyFieldName(field)} is already in use.` : error.message || "Failed to update", variant: "destructive" });
    } finally {
      setSavingCell(false); setEditingCell(null); setEditValue(""); isSavingRef.current = false;
    }
  };

  const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); saveEditingCell(); }
    else if (e.key === "Escape") { e.preventDefault(); cancelEditingCell(); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Parcel Management

              {/* ── Stylish IP reveal eye ── */}
              <div ref={ipPanelRef} className="relative flex items-center">
                <button
                  onClick={handleIpToggle}
                  disabled={ipLoading}
                  type="button"
                  title={ipVisible ? "Hide server IP" : "Reveal server IP"}
                  className={`
                    relative flex items-center justify-center w-7 h-7 rounded-full border
                    transition-all duration-300 cursor-pointer select-none
                    ${ipVisible
                      ? "border-cyan-400 bg-cyan-950 shadow-[0_0_10px_2px_rgba(34,211,238,0.45)]"
                      : "border-slate-600 bg-slate-900 hover:border-cyan-500 hover:shadow-[0_0_8px_1px_rgba(34,211,238,0.25)]"
                    }
                    ${ipLoading ? "animate-pulse" : ""}
                  `}
                >
                  {/* outer glow ring when active */}
                  {ipVisible && (
                    <span className="absolute inset-0 rounded-full animate-ping opacity-20 bg-cyan-400 pointer-events-none" />
                  )}
                  {ipVisible
                    ? <Eye className="h-3.5 w-3.5 text-cyan-300 drop-shadow-[0_0_4px_rgba(34,211,238,0.9)]" />
                    : <EyeOff className="h-3.5 w-3.5 text-slate-400" />
                  }
                </button>

                {/* ── Floating IP card ── */}
                {ipVisible && serverIp && (
                  <div className="absolute left-1/2 -translate-x-1/2 top-9 z-50 w-64 animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* glow border wrapper */}
                    <div className="rounded-xl border border-cyan-500/60 shadow-[0_0_24px_4px_rgba(34,211,238,0.18)] overflow-hidden">
                      <div className="bg-[#060d1a] px-4 py-3">
                        {/* label row */}
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[9px] font-bold uppercase tracking-[3px] text-cyan-500/70">
                            Server IP
                          </span>
                          <span className="text-[9px] font-mono text-emerald-400/60 animate-pulse">● LIVE</span>
                        </div>

                        {/* IP display */}
                        <div className="flex items-center justify-between gap-2 bg-black/40 rounded-lg px-3 py-2 border border-cyan-900/60">
                          <span
                            className="font-mono text-sm font-bold tracking-widest text-cyan-300"
                            style={{ textShadow: "0 0 10px rgba(34,211,238,0.8), 0 0 20px rgba(34,211,238,0.4)" }}
                          >
                            {serverIp}
                          </span>
                          <button
                            onClick={handleIpCopy}
                            type="button"
                            title="Copy IP"
                            className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md transition-all duration-200
                              bg-cyan-900/40 hover:bg-cyan-500/20 border border-cyan-700/40 hover:border-cyan-400/60
                              hover:shadow-[0_0_6px_rgba(34,211,238,0.4)]"
                          >
                            {ipCopied
                              ? <Check className="h-3 w-3 text-emerald-400" />
                              : <Copy className="h-3 w-3 text-cyan-400" />
                            }
                          </button>
                        </div>

                      </div>
                    </div>
                    {/* arrow */}
                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45
                      bg-[#060d1a] border-l border-t border-cyan-500/60" />
                  </div>
                )}
              </div>
            </CardTitle>

            <div className="flex items-center gap-2 flex-wrap">
              {/* Generate Manifest button — prominent when parcels are selected */}
              {selectedCount > 0 && (
                <Button
                  variant="default"
                  className="bg-orange-500 hover:bg-orange-600 text-white gap-2 shadow-md animate-in fade-in slide-in-from-right-2 duration-200"
                  onClick={handleGenerateManifest}
                  disabled={exportingManifest}
                >
                  <Sparkles className="h-4 w-4" />
                  {exportingManifest
                    ? "Generating…"
                    : `Generate Manifest (${selectedCount})`}
                </Button>
              )}

              <Dialog open={showCreateForm} onOpenChange={setShowCreateForm}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Parcel
                  </Button>
                </DialogTrigger>
                <DialogContent className="w-full max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden bg-[#0b0d1a] border border-white/10 text-white p-0 [&>button]:text-white/50 [&>button]:hover:text-white [&>button]:top-3 [&>button]:right-3">
                  <DialogHeader className="sr-only">
                    <DialogTitle>Create New Parcel</DialogTitle>
                  </DialogHeader>
                  <ParcelForm onSuccess={handleParcelCreated} />
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Search + selection summary */}
          <div className="flex items-center gap-4 mt-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by tracking ID, reference ID, name, or phone…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
            {selectedCount > 0 && (
              <span className="text-sm text-muted-foreground whitespace-nowrap">
                {selectedCount} selected
                <button
                  className="ml-2 text-primary underline-offset-2 hover:underline"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </button>
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="w-full">
            {/* ── Desktop table (md+) ──────────────────────────────────────── */}
            <div className="hidden md:block overflow-x-auto">
              <Table className="text-xs w-full table-fixed">
                <TableHeader>
                  <TableRow className="bg-gradient-to-r from-slate-800 to-blue-900 hover:from-slate-800 hover:to-blue-900">
                    <TableHead className="w-9 pl-3 pr-0">
                      <Checkbox
                        checked={allFilteredSelected}
                        data-state={someFilteredSelected ? "indeterminate" : allFilteredSelected ? "checked" : "unchecked"}
                        onCheckedChange={toggleSelectAll}
                        aria-label="Select all"
                        className="border-white/40 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                      />
                    </TableHead>
                    <TableHead className="w-[13%] text-white font-bold py-3 text-[11px]">Ref / Tracking</TableHead>
                    <TableHead className="w-[16%] text-white font-bold py-3 text-[11px]">Sender</TableHead>
                    <TableHead className="w-[16%] text-white font-bold py-3 text-[11px]">Receiver</TableHead>
                    <TableHead className="w-[13%] text-white font-bold py-3 text-[11px]">Route</TableHead>
                    <TableHead className="w-[16%] text-white font-bold py-3 text-[11px]">Details / Price</TableHead>
                    <TableHead className="w-[13%] text-white font-bold py-3 text-[11px]">Status / Date</TableHead>
                    <TableHead className="w-[13%] text-white font-bold py-3 text-[11px] text-right pr-3">Actions</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {paginatedParcels.map((parcel, i) => {
                    const isSelected = selectedIds.has(parcel.id);
                    return (
                      <TableRow
                        key={parcel.id}
                        className={`align-top ${isSelected ? "bg-blue-50 hover:bg-blue-100" : i % 2 === 0 ? "bg-white hover:bg-slate-50" : "bg-slate-50/60 hover:bg-slate-100/70"}`}
                      >
                        <TableCell className="pl-3 pr-0 pt-3">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(parcel.id)}
                            aria-label={`Select parcel ${parcel.tracking_id}`}
                            className="border-primary data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                          />
                        </TableCell>
                        <TableCell className="py-2.5 pr-2">
                          {editingCell?.id === parcel.id && editingCell.field === "reference_id" ? (
                            <Input autoFocus value={editValue} disabled={savingCell}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={saveEditingCell} onKeyDown={handleEditKeyDown}
                              className="h-6 font-mono text-xs w-full mb-1" />
                          ) : canEditParcel ? (
                            <div
                              className="font-mono font-bold text-blue-600 cursor-pointer hover:underline decoration-dashed underline-offset-2 truncate"
                              onClick={() => startEditingCell(parcel, "reference_id")}
                              title={`Ref: ${parcel.reference_id || "N/A"} — click to edit`}
                            >
                              {parcel.reference_id || <span className="text-slate-400 font-normal">No Ref</span>}
                            </div>
                          ) : (
                            // ROLE GATE: not editable for partners — plain text
                            <div className="font-mono font-bold text-blue-600 truncate" title={`Ref: ${parcel.reference_id || "N/A"}`}>
                              {parcel.reference_id || <span className="text-slate-400 font-normal">No Ref</span>}
                            </div>
                          )}
                          {editingCell?.id === parcel.id && editingCell.field === "tracking_id" ? (
                            <Input autoFocus value={editValue} disabled={savingCell}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={saveEditingCell} onKeyDown={handleEditKeyDown}
                              className="h-6 font-mono text-xs w-full mt-1" />
                          ) : canEditParcel ? (
                            <div
                              className="font-mono text-[10px] text-slate-500 cursor-pointer hover:underline decoration-dashed underline-offset-2 truncate mt-0.5"
                              onClick={() => startEditingCell(parcel, "tracking_id")}
                              title={`Tracking: ${parcel.tracking_id} — click to edit`}
                            >
                              {parcel.tracking_id}
                            </div>
                          ) : (
                            // ROLE GATE: not editable for partners — plain text
                            <div className="font-mono text-[10px] text-slate-500 truncate mt-0.5" title={`Tracking: ${parcel.tracking_id}`}>
                              {parcel.tracking_id}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 pr-2">
                          <div className="font-semibold text-slate-800 truncate">{parcel.sender_name}</div>
                          <div className="text-[10px] text-slate-500 truncate">{parcel.sender_phone}</div>
                          {parcel.sender_city && <div className="text-[10px] text-slate-400 truncate">{parcel.sender_city}</div>}
                        </TableCell>
                        <TableCell className="py-2.5 pr-2">
                          <div className="font-semibold text-slate-800 truncate">{parcel.receiver_name}</div>
                          <div className="text-[10px] text-slate-500 truncate">{parcel.receiver_phone}</div>
                          {parcel.receiver_city && <div className="text-[10px] text-slate-400 truncate">{parcel.receiver_city}</div>}
                        </TableCell>
                        <TableCell className="py-2.5 pr-2">
                          <div className="font-medium text-slate-700 truncate">{getCountryName(parcel.from_country)}</div>
                          <div className="text-[10px] text-blue-400 font-bold my-0.5">↓</div>
                          <div className="font-medium text-slate-700 truncate">{getCountryName(parcel.to_country)}</div>
                        </TableCell>
                        <TableCell className="py-2.5 pr-2">
                          <div className="font-bold text-slate-800">{parcel.currency} {parcel.total_price?.toFixed(2)}</div>
                          <div className="text-[10px] text-slate-500 mt-0.5">{parcel.parcel_type}</div>
                          <div className="text-[10px] text-slate-400">
                            {parcel.weight}kg{parcel.length ? ` · ${parcel.length}×${parcel.width}×${parcel.height}cm` : ""}
                          </div>
                          {(parcel.branch || parcel.made_by_name) && (
                            <div className="text-[10px] font-semibold text-sky-700 bg-sky-50 border border-sky-100 rounded px-1 py-0.5 inline-block mt-1 max-w-full truncate">
                              {parcel.branch || parcel.made_by_name}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="py-2.5 pr-2">
                          <Badge className={`text-[10px] px-1.5 py-0.5 whitespace-nowrap ${statusColors[parcel.current_status] || "bg-gray-100 text-gray-800"}`}>
                            {parcel.current_status.replace(/_/g, " ")}
                          </Badge>
                          <div className="text-[10px] text-slate-400 mt-1.5">
                            {new Date(parcel.created_at).toLocaleDateString()}
                          </div>
                        </TableCell>
                        <TableCell className="py-2 pr-2">
                          <div className="flex items-center justify-end gap-0.5 flex-wrap">
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                              onClick={() => { setSelectedParcel(parcel); setShowDetailsModal(true); }} title="View details">
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                            {canEditParcel && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-amber-600 hover:bg-amber-50"
                                onClick={() => handleEditClick(parcel)} title="Edit">
                                <Edit className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-fuchsia-600 hover:bg-fuchsia-50"
                              onClick={() => handleCloneParcel(parcel)} disabled={cloningId === parcel.id} title="Clone parcel">
                              {cloningId === parcel.id
                                ? <span className="animate-spin h-3.5 w-3.5 border-2 border-fuchsia-300 border-t-fuchsia-600 rounded-full inline-block" />
                                : <CopyPlus className="h-3.5 w-3.5" />
                              }
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-violet-600 hover:bg-violet-50"
                              onClick={() => handleAttachmentsClick(parcel)} title="Attachments">
                              <Paperclip className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"
                              onClick={() => handleInvoiceClick(parcel)} disabled={loadingInvoice} title="Generate AWB / Invoice">
                              <FileText className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-sky-600 hover:bg-sky-50"
                              onClick={() => { setLabelParcel(parcel); setShowLabel(true); }} title="Print Shipping Label">
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-500 hover:text-teal-600 hover:bg-teal-50"
                              onClick={() => { setUndertakingParcel(parcel); setShowUndertaking(true); }} title="Undertaking Letter">
                              <ScrollText className="h-3.5 w-3.5" />
                            </Button>
                            {canDeleteParcel && (
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50"
                                onClick={() => handleDeleteParcel(parcel.id, parcel.tracking_id)} title="Delete">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {canEmailParcel && (
                              <Button
                                variant="ghost" size="icon"
                                className={`h-7 w-7 ${emailedIds.has(parcel.id) ? "text-emerald-500 hover:bg-emerald-50" : "text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"}`}
                                onClick={() => handleSendXrayEmail(parcel)}
                                disabled={emailingId === parcel.id || !parcel.receiver_email}
                                title={emailedIds.has(parcel.id) ? "Resend X-Ray Email" : "Send X-Ray Email"}
                              >
                                {emailingId === parcel.id
                                  ? <span className="animate-spin h-3.5 w-3.5 border-2 border-emerald-300 border-t-emerald-600 rounded-full inline-block" />
                                  : emailedIds.has(parcel.id)
                                    ? <CheckCircle className="h-3.5 w-3.5" />
                                    : <Mail className="h-3.5 w-3.5" />
                                }
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* ── Mobile cards (< md) ──────────────────────────────────────── */}
            <div className="md:hidden divide-y divide-slate-100">
              {/* Select-all row */}
              {paginatedParcels.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-gradient-to-r from-slate-800 to-blue-900">
                  <Checkbox
                    checked={allFilteredSelected}
                    data-state={someFilteredSelected ? "indeterminate" : allFilteredSelected ? "checked" : "unchecked"}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                    className="border-white/40 data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                  />
                  <span className="text-white text-xs font-semibold">Select all on this page</span>
                </div>
              )}

              {paginatedParcels.map((parcel, i) => {
                const isSelected = selectedIds.has(parcel.id);
                return (
                  <div
                    key={parcel.id}
                    className={`px-4 py-3 ${isSelected ? "bg-blue-50" : i % 2 === 0 ? "bg-white" : "bg-slate-50/60"}`}
                  >
                    {/* Top row: checkbox + IDs + status badge */}
                    <div className="flex items-start gap-3">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(parcel.id)}
                        aria-label={`Select parcel ${parcel.tracking_id}`}
                        className="mt-0.5 border-primary data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          {/* Ref ID */}
                          {editingCell?.id === parcel.id && editingCell.field === "reference_id" ? (
                            <Input autoFocus value={editValue} disabled={savingCell}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={saveEditingCell} onKeyDown={handleEditKeyDown}
                              className="h-7 font-mono text-xs w-36" />
                          ) : canEditParcel ? (
                            <span
                              className="font-mono font-bold text-blue-600 text-sm cursor-pointer"
                              onClick={() => startEditingCell(parcel, "reference_id")}
                              title="Tap to edit reference ID"
                            >
                              {parcel.reference_id || <span className="text-slate-400 font-normal text-xs">No Ref</span>}
                            </span>
                          ) : (
                            // ROLE GATE: not editable for partners — plain text
                            <span className="font-mono font-bold text-blue-600 text-sm">
                              {parcel.reference_id || <span className="text-slate-400 font-normal text-xs">No Ref</span>}
                            </span>
                          )}
                          <Badge className={`text-[10px] px-1.5 py-0.5 whitespace-nowrap shrink-0 ${statusColors[parcel.current_status] || "bg-gray-100 text-gray-800"}`}>
                            {parcel.current_status.replace(/_/g, " ")}
                          </Badge>
                        </div>

                        {/* Tracking ID */}
                        {editingCell?.id === parcel.id && editingCell.field === "tracking_id" ? (
                          <Input autoFocus value={editValue} disabled={savingCell}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={saveEditingCell} onKeyDown={handleEditKeyDown}
                            className="h-7 font-mono text-xs w-full mt-1" />
                        ) : canEditParcel ? (
                          <div
                            className="font-mono text-xs text-slate-500 mt-0.5 cursor-pointer"
                            onClick={() => startEditingCell(parcel, "tracking_id")}
                            title="Tap to edit tracking ID"
                          >
                            {parcel.tracking_id}
                          </div>
                        ) : (
                          // ROLE GATE: not editable for partners — plain text
                          <div className="font-mono text-xs text-slate-500 mt-0.5">
                            {parcel.tracking_id}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Middle: sender → receiver + price */}
                    <div className="mt-2.5 ml-7 grid grid-cols-2 gap-x-3 gap-y-1.5">
                      <div>
                        <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wide mb-0.5">From</p>
                        <p className="text-xs font-semibold text-slate-800 truncate">{parcel.sender_name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{parcel.sender_phone}</p>
                        <p className="text-[10px] text-slate-400 truncate">{getCountryName(parcel.from_country)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wide mb-0.5">To</p>
                        <p className="text-xs font-semibold text-slate-800 truncate">{parcel.receiver_name}</p>
                        <p className="text-[10px] text-slate-500 truncate">{parcel.receiver_phone}</p>
                        <p className="text-[10px] text-slate-400 truncate">{getCountryName(parcel.to_country)}</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wide mb-0.5">Price</p>
                        <p className="text-xs font-bold text-slate-800">{parcel.currency} {parcel.total_price?.toFixed(2)}</p>
                        <p className="text-[10px] text-slate-500">{parcel.parcel_type} · {parcel.weight}kg</p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold text-blue-700 uppercase tracking-wide mb-0.5">Date</p>
                        <p className="text-[10px] text-slate-600">{new Date(parcel.created_at).toLocaleDateString()}</p>
                        {(parcel.branch || parcel.made_by_name) && (
                          <p className="text-[10px] font-semibold text-sky-700 truncate">{parcel.branch || parcel.made_by_name}</p>
                        )}
                      </div>
                    </div>

                    {/* Actions row */}
                    <div className="mt-2.5 ml-7 flex items-center gap-1 flex-wrap">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-blue-600 hover:bg-blue-50"
                        onClick={() => { setSelectedParcel(parcel); setShowDetailsModal(true); }} title="View details">
                        <Eye className="h-4 w-4" />
                      </Button>
                      {canEditParcel && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-amber-600 hover:bg-amber-50"
                          onClick={() => handleEditClick(parcel)} title="Edit">
                          <Edit className="h-4 w-4" />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-fuchsia-600 hover:bg-fuchsia-50"
                        onClick={() => handleCloneParcel(parcel)} disabled={cloningId === parcel.id} title="Clone parcel">
                        {cloningId === parcel.id
                          ? <span className="animate-spin h-4 w-4 border-2 border-fuchsia-300 border-t-fuchsia-600 rounded-full inline-block" />
                          : <CopyPlus className="h-4 w-4" />
                        }
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-violet-600 hover:bg-violet-50"
                        onClick={() => handleAttachmentsClick(parcel)} title="Attachments">
                        <Paperclip className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"
                        onClick={() => handleInvoiceClick(parcel)} disabled={loadingInvoice} title="AWB / Invoice">
                        <FileText className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-sky-600 hover:bg-sky-50"
                        onClick={() => { setLabelParcel(parcel); setShowLabel(true); }} title="Shipping Label">
                        <Printer className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-teal-600 hover:bg-teal-50"
                        onClick={() => { setUndertakingParcel(parcel); setShowUndertaking(true); }} title="Undertaking Letter">
                        <ScrollText className="h-4 w-4" />
                      </Button>
                      {canDeleteParcel && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => handleDeleteParcel(parcel.id, parcel.tracking_id)} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      {canEmailParcel && (
                        <Button
                          variant="ghost" size="icon"
                          className={`h-8 w-8 ${emailedIds.has(parcel.id) ? "text-emerald-500 hover:bg-emerald-50" : "text-slate-500 hover:text-emerald-600 hover:bg-emerald-50"}`}
                          onClick={() => handleSendXrayEmail(parcel)}
                          disabled={emailingId === parcel.id || !parcel.receiver_email}
                          title={emailedIds.has(parcel.id) ? "Resend X-Ray Email" : "Send X-Ray Email"}
                        >
                          {emailingId === parcel.id
                            ? <span className="animate-spin h-4 w-4 border-2 border-emerald-300 border-t-emerald-600 rounded-full inline-block" />
                            : emailedIds.has(parcel.id)
                              ? <CheckCircle className="h-4 w-4" />
                              : <Mail className="h-4 w-4" />
                          }
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {paginatedParcels.length === 0 && !loading && (
              <div className="text-center py-12">
                <Package className="h-12 w-12 mx-auto text-muted-foreground opacity-40 mb-3" />
                <p className="text-muted-foreground">No parcels found</p>
              </div>
            )}
          </div>

          {totalCount > 0 && (
            <div className="mt-4 flex flex-col gap-3 border-t pt-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, totalCount)} of {totalCount} parcels
              </p>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  Previous
                </Button>
                <span className="min-w-20 text-center text-muted-foreground">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  disabled={currentPage === totalPages}
                >
                  Next
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              </div>
            </div>
          )}

          {/* Bottom manifest action bar — appears when parcels are selected */}
          {selectedCount > 0 && (
            <div className="mt-4 flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 px-4 py-3 animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center gap-2 text-sm font-medium text-orange-800">
                <CheckSquare className="h-4 w-4" />
                {selectedCount} parcel{selectedCount !== 1 ? "s" : ""} selected
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-orange-300 text-orange-700 hover:bg-orange-100"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear
                </Button>
                <Button
                  size="sm"
                  className="bg-orange-500 hover:bg-orange-600 text-white gap-2"
                  onClick={handleGenerateManifest}
                  disabled={exportingManifest}
                >
                  <Sparkles className="h-4 w-4" />
                  {exportingManifest ? "Generating…" : "Generate Manifest"}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Parcel Details Modal */}
      <Dialog open={showDetailsModal} onOpenChange={setShowDetailsModal}>
        <DialogContent className="w-full max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          <DialogHeader><DialogTitle>Parcel Details</DialogTitle></DialogHeader>
          {selectedParcel && (
            <ParcelDetails parcel={selectedParcel} onUpdate={fetchAllParcels} onClose={() => setShowDetailsModal(false)} readOnly={isPartnerView} />
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Parcel Modal */}
      <Dialog open={showEditForm} onOpenChange={(open) => { setShowEditForm(open); if (!open) setEditingParcel(null); }}>
        <DialogContent className="w-full max-w-4xl max-h-[90vh] overflow-y-auto overflow-x-hidden bg-[#0b0d1a] border border-white/10 text-white p-0 [&>button]:text-white/50 [&>button]:hover:text-white [&>button]:top-3 [&>button]:right-3">
          <DialogHeader className="sr-only"><DialogTitle>Edit Parcel — {editingParcel?.tracking_id}</DialogTitle></DialogHeader>
          {editingParcel && <ParcelForm parcel={editingParcel} onSuccess={handleParcelUpdated} lockIdentifiers={isRestrictedUser} />}
        </DialogContent>
      </Dialog>

      {/* Attachments Modal */}
      <ParcelAttachmentsDialog
        parcel={attachmentsParcel ? { id: attachmentsParcel.id, tracking_id: attachmentsParcel.tracking_id } : null}
        open={showAttachments}
        onOpenChange={(open) => { setShowAttachments(open); if (!open) setAttachmentsParcel(null); }}
      />

      {/* AWB / Invoice Modal */}
      {invoiceParcel && (
        <SkyXpressAWBInvoice
          open={showInvoice}
          onClose={() => { setShowInvoice(false); setInvoiceParcel(null); }}
          parcel={invoiceParcel}
        />
      )}

      {/* Shipping Label Modal */}
      <ShippingLabel
        parcel={labelParcel}
        open={showLabel}
        onClose={() => { setShowLabel(false); setLabelParcel(null); }}
        countryMap={countryMap}
      />

      {/* Undertaking Letter Modal */}
      <UndertakingLetter
        parcel={undertakingParcel}
        open={showUndertaking}
        onClose={() => { setShowUndertaking(false); setUndertakingParcel(null); }}
      />

      {/* ── Step 1: Confirm / Edit Manifest ID ───────────────────────────── */}
      <ManifestDialog open={showConfirmDialog} onOpenChange={(o) => { if (!o) { setShowConfirmDialog(false); setPendingParcels([]); } }}>
        <ManifestDialogContent className="max-w-md">
          <ManifestDialogHeader>
            <ManifestDialogTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="h-5 w-5 text-orange-500" />
              Confirm Manifest ID
            </ManifestDialogTitle>
          </ManifestDialogHeader>

          <div className="space-y-5 pt-1">
            <p className="text-sm text-muted-foreground">
              The ID below was auto-generated sequentially. You can edit it before finalising.
            </p>

            {/* ID input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-blue-700 uppercase tracking-wide">Manifest ID</label>
              <Input
                value={pendingManifestId}
                onChange={(e) => { setPendingManifestId(e.target.value.toUpperCase()); setIdError(""); }}
                className="font-mono text-xl font-bold tracking-widest text-center h-12 border-2 border-orange-300 focus:border-orange-500"
                placeholder="00191100"
                maxLength={20}
              />
              {idError && <p className="text-xs text-red-600">{idError}</p>}
              <p className="text-xs text-muted-foreground text-center">
                Format: 8-digit number (e.g. <span className="font-mono font-semibold">00191100</span>) or any custom code
              </p>
            </div>

            {/* Summary */}
            <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-lg p-3 border border-slate-100 text-center text-sm">
              {[
                ["Parcels",  String(pendingParcels.length)],
                ["Weight",   `${pendingParcels.reduce((s, p) => s + Number(p.weight ?? 0), 0).toFixed(2)} kg`],
                ["Value",    `${pendingParcels[0]?.currency || "USD"} ${pendingParcels.reduce((s, p) => s + Number(p.total_price ?? 0), 0).toFixed(2)}`],
              ].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">{label}</p>
                  <p className="font-semibold text-slate-800 mt-0.5 text-xs">{value}</p>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => { setShowConfirmDialog(false); setPendingParcels([]); }}>
                Cancel
              </Button>
              <Button className="flex-1 bg-orange-500 hover:bg-orange-600 text-white gap-2" onClick={handleConfirmManifest}>
                <Sparkles className="h-4 w-4" />
                Generate Manifest
              </Button>
            </div>
          </div>
        </ManifestDialogContent>
      </ManifestDialog>

      {/* ── Step 2: Manifest Generated — Download ────────────────────────── */}
      <ManifestDialog open={!!generatedEntry} onOpenChange={(o) => { if (!o) setGeneratedEntry(null); }}>
        <ManifestDialogContent className="max-w-lg">
          <ManifestDialogHeader>
            <ManifestDialogTitle className="flex items-center gap-2 text-lg">
              <ClipboardList className="h-5 w-5 text-orange-500" />
              Manifest Generated!
            </ManifestDialogTitle>
          </ManifestDialogHeader>

          {generatedEntry && (
            <div className="space-y-5 pt-1">
              {/* Manifest ID badge */}
              <div className="flex flex-col items-center gap-1 py-4 bg-gradient-to-br from-slate-900 to-blue-950 rounded-xl">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest">Manifest ID</p>
                <p className="font-mono font-bold text-3xl text-orange-400 tracking-widest mt-1">
                  {generatedEntry.manifestId}
                </p>
                <p className="text-slate-400 text-xs mt-1">
                  {generatedEntry.parcelCount} parcel{generatedEntry.parcelCount !== 1 ? "s" : ""}
                  {" · "}{generatedEntry.totalWeight.toFixed(2)} kg
                  {" · "}{generatedEntry.currency} {generatedEntry.totalValue.toFixed(2)}
                </p>
              </div>

              {/* Info */}
              <div className="grid grid-cols-2 gap-3 text-sm bg-slate-50 rounded-lg p-3 border border-slate-100">
                <div>
                  <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">Date</p>
                  <p className="font-medium">{new Date(generatedEntry.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">Service</p>
                  <p className="font-medium">{generatedEntry.serviceType}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">From</p>
                  <p className="font-medium">{generatedEntry.fromCountry || "—"}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wide">To</p>
                  <p className="font-medium">{generatedEntry.toCountry || "—"}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Saved to Manifest Stock. Download in your preferred format:
              </p>

              {/* Download buttons */}
              <div className="grid grid-cols-2 gap-3">
                <Button
                  className="gap-2 bg-green-600 hover:bg-green-700 text-white h-12"
                  onClick={handleDownloadExcel}
                  disabled={!!downloadingFormat}
                >
                  <FileSpreadsheet className="h-5 w-5" />
                  {downloadingFormat === "xls" ? "Generating…" : "Download Excel"}
                </Button>
                <Button
                  className="gap-2 bg-blue-600 hover:bg-blue-700 text-white h-12"
                  onClick={handleDownloadPDF}
                  disabled={!!downloadingFormat}
                >
                  <FileDown className="h-5 w-5" />
                  {downloadingFormat === "pdf" ? "Generating…" : "Download PDF"}
                </Button>
              </div>

              <p className="text-xs text-center text-muted-foreground">
                You can also re-download from the{" "}
                <span className="font-semibold text-blue-600">Manifest Stock</span> tab anytime.
              </p>
            </div>
          )}
        </ManifestDialogContent>
      </ManifestDialog>
    </div>
  );
};
