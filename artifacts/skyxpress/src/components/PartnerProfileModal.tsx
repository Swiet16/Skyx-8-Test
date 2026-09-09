// @ts-nocheck
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog, DialogContent,
} from "@/components/ui/dialog";
import {
  Building2, Mail, Phone, Calendar, User, CreditCard,
  MapPin, FileText, Upload, RefreshCw, Eye,
  CheckCircle2, AlertCircle, ImageIcon, Trash2,
  ChevronDown, Globe, Landmark, BarChart3,
  Activity, Shield, Instagram, Linkedin,
  Facebook, Clock, Hash, Briefcase, Wallet,
  Camera, Link, IdCard,
} from "lucide-react";

const CNIC_BUCKET = "partner-cnic";
const BRANCH_OPTIONS = [
  "GRT - GUJRAT","LHE - LAHORE","KHI - KARACHI","ISB - ISLAMABAD",
  "MUL - MULTAN","FSD - FAISALABAD","PEW - PESHAWAR","QTA - QUETTA",
  "HYD - HYDERABAD","SKT - SIALKOT","UK BRANCH - MCS UK",
  "USA BRANCH - MCS USA","CANADA - MCS CAN","SPAIN - MCS ESP",
  "ITALY - MCS ITA","AUSTRALIA - MCS AUS","HEAD OFFICE",
];
const ORG_SIZE_OPTIONS = ["1–10","11–50","51–200","201–500","500+"];
const PAYMENT_METHODS = ["Bank Transfer","EasyPaisa","JazzCash","Cash","IBAN"];
const BUSINESS_TYPES = ["Sole Proprietor","Partnership","Private Limited","Public Limited","NGO","Other"];
const PARTNER_CATEGORIES = ["Logistics","Courier","Freight","E-Commerce","Retail","Wholesale","Other"];

const initials = (name?: string | null) => {
  if (!name) return "?";
  const p = name.trim().split(" ");
  return p.length === 1 ? p[0][0].toUpperCase() : (p[0][0] + p[p.length - 1][0]).toUpperCase();
};
const fmt = (iso?: string) => iso
  ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  : "—";

// ── Status badge ──────────────────────────────────────────────────────────────
const StatusBadge = ({ status }: { status?: string }) => {
  const cfg: Record<string, { cls: string; Icon: any; label: string }> = {
    active:    { cls: "bg-emerald-500/15 border-emerald-500/30 text-emerald-400", Icon: CheckCircle2, label: "Active" },
    suspended: { cls: "bg-red-500/15 border-red-500/30 text-red-400", Icon: AlertCircle, label: "Suspended" },
    pending:   { cls: "bg-amber-500/15 border-amber-500/30 text-amber-400", Icon: Clock, label: "Pending" },
  };
  const c = cfg[status || "active"] || cfg.active;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${c.cls}`}>
      <c.Icon className="h-2.5 w-2.5" /> {c.label}
    </span>
  );
};

// ── Collapsible section card ──────────────────────────────────────────────────
const Section = ({ title, icon: Icon, color = "white", children, defaultOpen = true }: any) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-white/8 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white/4 hover:bg-white/7 transition-colors"
      >
        <span className="flex items-center gap-2.5 text-sm font-semibold text-white">
          <Icon className={`h-4 w-4 text-${color}-400`} />
          {title}
        </span>
        <ChevronDown className={`h-4 w-4 text-white/30 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="p-4 space-y-4 border-t border-white/6">{children}</div>}
    </div>
  );
};

// ── Field row helper ──────────────────────────────────────────────────────────
const Field = ({ label, icon: Icon, children }: any) => (
  <div className="space-y-1.5">
    <Label className="text-[11px] text-white/45 font-semibold uppercase tracking-wider flex items-center gap-1.5">
      {Icon && <Icon className="h-3 w-3" />} {label}
    </Label>
    {children}
  </div>
);

const TInput = ({ ...props }) => (
  <Input
    {...props}
    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-emerald-500/40 h-9 text-sm"
  />
);

const TSelect = ({ value, onChange, options, placeholder }: any) => (
  <select
    value={value || ""}
    onChange={(e) => onChange(e.target.value)}
    className="w-full h-9 rounded-md bg-white/5 border border-white/10 text-white text-sm px-3 focus:border-emerald-500/40 focus:outline-none"
  >
    <option value="" className="bg-[#0d1117]">{placeholder || "Select…"}</option>
    {options.map((o: any) => (
      <option key={typeof o === "string" ? o : o.value} value={typeof o === "string" ? o : o.value} className="bg-[#0d1117]">
        {typeof o === "string" ? o : o.label}
      </option>
    ))}
  </select>
);

// ── Generic file upload ───────────────────────────────────────────────────────
const DocUpload = ({
  label, bucket = CNIC_BUCKET, userId, fieldKey, currentUrl, onUploaded,
}: {
  label: string; bucket?: string; userId: string; fieldKey: string;
  currentUrl?: string | null; onUploaded: (url: string) => void;
}) => {
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(currentUrl || null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setPreview(currentUrl || null); }, [currentUrl]);

  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Too large", description: "Max 10 MB.", variant: "destructive" }); return;
    }
    setUploading(true);
    setPreview(URL.createObjectURL(file));
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${userId}/${fieldKey}_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw error;
      const { data } = supabase.storage.from(bucket).getPublicUrl(path);
      onUploaded(data?.publicUrl || "");
      toast({ title: `${label} uploaded ✓` });
    } catch (err: any) {
      setPreview(currentUrl || null);
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally { setUploading(false); }
  };

  const isImage = preview && /\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(preview);

  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] text-white/45 font-semibold uppercase tracking-wider">{label}</Label>
      {preview ? (
        <div className="relative rounded-xl overflow-hidden border border-white/10 bg-white/4">
          {isImage
            ? <img src={preview} alt={label} className="w-full h-36 object-cover" />
            : <div className="flex items-center gap-2 px-3 py-3 text-xs text-white/60"><FileText className="h-4 w-4 text-sky-400" /><span className="truncate">{preview.split("/").pop()}</span></div>
          }
          <div className="flex gap-2 p-2 bg-black/40">
            <Button size="sm" className="h-7 text-xs bg-white/15 hover:bg-white/25 text-white border-0 gap-1"
              onClick={() => inputRef.current?.click()} disabled={uploading}>
              <Upload className="h-3 w-3" /> {uploading ? "Uploading…" : "Replace"}
            </Button>
            <Button size="sm" className="h-7 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 border-0 gap-1"
              onClick={() => { setPreview(null); onUploaded(""); }}>
              <Trash2 className="h-3 w-3" /> Remove
            </Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className="w-full flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-white/12 bg-white/3 hover:border-emerald-500/35 hover:bg-emerald-500/4 transition-all py-6 text-white/35 hover:text-white/55 disabled:opacity-50">
          {uploading ? <RefreshCw className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
          <span className="text-[11px] font-medium">{uploading ? "Uploading…" : `Upload ${label}`}</span>
          <span className="text-[10px] text-white/20">Max 10 MB</span>
        </button>
      )}
      <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
};

const StatCard = ({ label, value, icon: Icon, color = "emerald" }: any) => (
  <div className={`rounded-xl border border-${color}-500/15 bg-${color}-500/5 p-3 text-center`}>
    <Icon className={`h-5 w-5 text-${color}-400 mx-auto mb-1`} />
    <p className="text-xl font-bold text-white">{value ?? "—"}</p>
    <p className="text-[11px] text-white/35 mt-0.5">{label}</p>
  </div>
);

// ── Main Modal ────────────────────────────────────────────────────────────────
export const PartnerProfileModal = ({
  open, onClose, user, partnerProfile, allPartnerProfiles, onSaved,
}: {
  open: boolean; onClose: () => void;
  user: any | null; partnerProfile: any | null;
  allPartnerProfiles: any[]; onSaved: (profile: any) => void;
}) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});

  const blank = {
    user_id: user?.user_id || "",
    // Core
    username: "", bio: "", branch: "", status: "active",
    // Contact
    mobile: "", whatsapp: "", alt_phone: "", website: "",
    facebook: "", linkedin: "", instagram: "",
    // Address
    country: "", province: "", city: "", area: "",
    street_address: "", postal_code: "", google_maps_url: "",
    // Identity
    cnic: "", cnic_image_url: "", cnic_back_url: "", selfie_url: "",
    passport_number: "", tax_number: "",
    // Business
    business_type: "", partner_category: "",
    company_reg_number: "", business_license: "", tax_reg_number: "",
    org_size: "", years_in_business: "", main_services: "",
    service_regions: "", operating_hours: "",
    // Bank
    bank_name: "", account_title: "", account_number: "", iban: "",
    bank_branch_name: "", bank_branch_code: "",
    easypaisa_number: "", jazzcash_number: "", preferred_payment: "",
    // Documents
    profile_photo_url: "", company_logo_url: "",
    business_cert_url: "", tax_cert_url: "", agreement_url: "",
    // NOTE: permission toggles (can_create_agents, can_assign_tasks,
    // can_manage_attendance, can_view_salary, can_export_reports,
    // can_invite_users, login_enabled, can_manage_users) were REMOVED.
    // Permissions are now decided ONLY by the account's role
    // (admin / staff / partner) — there are no per-user allow toggles.
  };

  useEffect(() => {
    if (user && partnerProfile) setForm({ ...blank, ...partnerProfile, user_id: user.user_id });
    else if (user) setForm({ ...blank, user_id: user.user_id });
  }, [user, partnerProfile, open]);

  const set = (field: string) => (val: any) => setForm((p: any) => ({ ...p, [field]: val }));
  const setVal = (field: string, val: any) => setForm((p: any) => ({ ...p, [field]: val }));

  const handleSave = async () => {
    if (!user) return;

    // Uniqueness check
    const others = allPartnerProfiles.filter((p) => p.user_id !== user.user_id);
    if (form.username) {
      const dup = others.find((p) => p.username?.toLowerCase() === form.username?.toLowerCase());
      if (dup) { toast({ title: "Username taken", description: `@${form.username} is already used.`, variant: "destructive" }); return; }
    }
    if (form.cnic) {
      const dup = others.find((p) => p.cnic?.replace(/[-\s]/g, "") === form.cnic?.replace(/[-\s]/g, ""));
      if (dup) { toast({ title: "CNIC duplicate", description: "CNIC already registered to another partner.", variant: "destructive" }); return; }
    }

    setSaving(true);
    try {
      const payload: any = {
        user_id: user.user_id,
        username: form.username?.trim() || null,
        cnic: form.cnic?.trim() || null,
        bio: form.bio?.trim() || null,
        branch: form.branch?.trim() || null,
        cnic_image_url: form.cnic_image_url?.trim() || null,
        status: form.status || "active",
        updated_at: new Date().toISOString(),
        // Extended fields — save all; Supabase will use what columns exist
        mobile: form.mobile?.trim() || null,
        whatsapp: form.whatsapp?.trim() || null,
        alt_phone: form.alt_phone?.trim() || null,
        website: form.website?.trim() || null,
        facebook: form.facebook?.trim() || null,
        linkedin: form.linkedin?.trim() || null,
        instagram: form.instagram?.trim() || null,
        country: form.country?.trim() || null,
        province: form.province?.trim() || null,
        city: form.city?.trim() || null,
        area: form.area?.trim() || null,
        street_address: form.street_address?.trim() || null,
        postal_code: form.postal_code?.trim() || null,
        google_maps_url: form.google_maps_url?.trim() || null,
        cnic_back_url: form.cnic_back_url?.trim() || null,
        selfie_url: form.selfie_url?.trim() || null,
        passport_number: form.passport_number?.trim() || null,
        tax_number: form.tax_number?.trim() || null,
        business_type: form.business_type?.trim() || null,
        partner_category: form.partner_category?.trim() || null,
        company_reg_number: form.company_reg_number?.trim() || null,
        business_license: form.business_license?.trim() || null,
        tax_reg_number: form.tax_reg_number?.trim() || null,
        org_size: form.org_size?.trim() || null,
        years_in_business: form.years_in_business?.trim() || null,
        main_services: form.main_services?.trim() || null,
        service_regions: form.service_regions?.trim() || null,
        operating_hours: form.operating_hours?.trim() || null,
        bank_name: form.bank_name?.trim() || null,
        account_title: form.account_title?.trim() || null,
        account_number: form.account_number?.trim() || null,
        iban: form.iban?.trim() || null,
        bank_branch_name: form.bank_branch_name?.trim() || null,
        bank_branch_code: form.bank_branch_code?.trim() || null,
        easypaisa_number: form.easypaisa_number?.trim() || null,
        jazzcash_number: form.jazzcash_number?.trim() || null,
        preferred_payment: form.preferred_payment?.trim() || null,
        profile_photo_url: form.profile_photo_url?.trim() || null,
        company_logo_url: form.company_logo_url?.trim() || null,
        business_cert_url: form.business_cert_url?.trim() || null,
        tax_cert_url: form.tax_cert_url?.trim() || null,
        agreement_url: form.agreement_url?.trim() || null,
        // NOTE: permission fields are intentionally NOT saved anymore —
        // permissions come from the login role only (no allow-toggles).
      };

      let result;
      if (partnerProfile?.id) {
        result = await supabase.from("partner_profiles").update(payload).eq("id", partnerProfile.id).select().single();
      } else {
        result = await supabase.from("partner_profiles").insert({ ...payload, created_at: new Date().toISOString() }).select().single();
      }

      if (result.error) {
        // If extended columns don't exist yet, fall back to core fields only
        const core = {
          user_id: payload.user_id, username: payload.username, cnic: payload.cnic,
          bio: payload.bio, branch: payload.branch, cnic_image_url: payload.cnic_image_url,
          status: payload.status, updated_at: payload.updated_at,
        };
        if (partnerProfile?.id) {
          result = await supabase.from("partner_profiles").update(core).eq("id", partnerProfile.id).select().single();
        } else {
          result = await supabase.from("partner_profiles").insert({ ...core, created_at: new Date().toISOString() }).select().single();
        }
        if (result.error) throw result.error;
        toast({ title: "Profile saved ✓", description: "Core fields saved. Extended fields need DB migration." });
      } else {
        toast({ title: "Partner profile saved ✓" });
      }

      onSaved({ ...result.data, ...payload });
      onClose();
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  if (!user) return null;

  const pid = partnerProfile?.id ? partnerProfile.id.substring(0, 8).toUpperCase() : "AUTO";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[92vh] overflow-hidden flex flex-col bg-[#0d1117] border border-white/10 text-white p-0">

        {/* ── Sticky header ── */}
        <div className="shrink-0 border-b border-white/8 bg-[#0d1117]/95 backdrop-blur px-5 py-4">
          <div className="flex items-center gap-4">
            {/* Avatar / photo */}
            <div className="relative shrink-0">
              {form.profile_photo_url ? (
                <img src={form.profile_photo_url} alt="" className="h-14 w-14 rounded-full object-cover ring-2 ring-emerald-500/40" />
              ) : (
                <>
                  <div className="absolute -inset-0.5 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 blur-[2px]" />
                  <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 to-teal-700 text-sm font-bold text-white">
                    {initials(user.full_name)}
                  </div>
                </>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-bold text-white text-base truncate">{user.full_name || "Partner"}</h2>
                <StatusBadge status={form.status} />
              </div>
              <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                {form.username && <span className="text-xs text-white/40 font-mono">@{form.username}</span>}
                {user.email && <span className="text-xs text-white/35">{user.email}</span>}
                <span className="text-[10px] bg-white/6 border border-white/10 rounded px-1.5 py-0.5 text-white/30 font-mono">ID: {pid}</span>
              </div>
            </div>

            {/* Status quick-toggle */}
            <div className="shrink-0 flex items-center gap-2">
              <span className={`text-[11px] font-semibold ${form.status === "suspended" ? "text-red-400" : "text-white/25"}`}>Suspended</span>
              <Switch
                checked={form.status === "active"}
                onCheckedChange={(v) => setVal("status", v ? "active" : "suspended")}
                className="data-[state=checked]:bg-emerald-500 scale-90"
              />
              <span className={`text-[11px] font-semibold ${form.status === "active" ? "text-emerald-400" : "text-white/25"}`}>Active</span>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex-1 overflow-y-auto">
          <Tabs defaultValue="profile" className="h-full">
            <TabsList className="sticky top-0 z-10 w-full rounded-none bg-[#0d1117]/95 backdrop-blur border-b border-white/8 justify-start px-5 gap-1 h-10">
              {[
                { value: "profile", label: "Profile" },
                { value: "identity", label: "Identity & Business" },
                { value: "bank", label: "Bank" },
                { value: "permissions", label: "Documents" },
                { value: "stats", label: "Stats & Activity" },
              ].map(({ value, label }) => (
                <TabsTrigger key={value} value={value}
                  className="text-xs h-7 px-3 rounded-md data-[state=active]:bg-emerald-500/20 data-[state=active]:text-emerald-300 text-white/40 hover:text-white/70 transition-colors">
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>

            {/* ════════════════════════════════════════
                TAB: PROFILE
            ════════════════════════════════════════ */}
            <TabsContent value="profile" className="p-5 space-y-4 mt-0">

              <Section title="Partner Information" icon={User} color="emerald">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Username (unique)" icon={User}>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30 text-sm font-bold">@</span>
                      <TInput value={form.username || ""} placeholder="partnerusername" maxLength={40}
                        onChange={(e: any) => setVal("username", e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ""))}
                        className="pl-7 bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-emerald-500/40 h-9 text-sm" />
                    </div>
                  </Field>
                  <Field label="Full Name" icon={User}>
                    <TInput value={user.full_name || ""} readOnly className="bg-white/3 border-white/6 text-white/50 h-9 cursor-not-allowed text-sm" />
                  </Field>
                  <Field label="Organization Name" icon={Building2}>
                    <TInput value={user.company || ""} readOnly className="bg-white/3 border-white/6 text-white/50 h-9 cursor-not-allowed text-sm" />
                  </Field>
                  <Field label="Business Type" icon={Briefcase}>
                    <TSelect value={form.business_type} onChange={set("business_type")} options={BUSINESS_TYPES} placeholder="Select type…" />
                  </Field>
                  <Field label="Partner Category" icon={Hash}>
                    <TSelect value={form.partner_category} onChange={set("partner_category")} options={PARTNER_CATEGORIES} placeholder="Select category…" />
                  </Field>
                  <Field label="Branch" icon={MapPin}>
                    <TSelect value={form.branch} onChange={set("branch")} options={BRANCH_OPTIONS} placeholder="Select branch…" />
                  </Field>
                  <Field label="Status" icon={CheckCircle2}>
                    <TSelect value={form.status} onChange={set("status")} options={[{value:"active",label:"Active"},{value:"suspended",label:"Suspended"},{value:"pending",label:"Pending"}]} />
                  </Field>
                  <Field label="Joining Date">
                    <TInput value={fmt(user.created_at)} readOnly className="bg-white/3 border-white/6 text-white/50 h-9 cursor-not-allowed text-sm" />
                  </Field>
                </div>
                <Field label="Bio / Notes" icon={FileText}>
                  <Textarea value={form.bio || ""} onChange={(e: any) => setVal("bio", e.target.value)}
                    placeholder="Short bio, region, specialization…" maxLength={600}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-emerald-500/40 resize-none min-h-[80px] text-sm" />
                  <p className="text-[10px] text-white/20 text-right">{(form.bio || "").length}/600</p>
                </Field>
              </Section>

              <Section title="Contact Information" icon={Phone} color="sky">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Mobile Number" icon={Phone}><TInput value={form.mobile || ""} onChange={(e: any) => setVal("mobile", e.target.value)} placeholder="+92 300 0000000" /></Field>
                  <Field label="WhatsApp Number" icon={Phone}><TInput value={form.whatsapp || ""} onChange={(e: any) => setVal("whatsapp", e.target.value)} placeholder="+92 300 0000000" /></Field>
                  <Field label="Alternate Phone" icon={Phone}><TInput value={form.alt_phone || ""} onChange={(e: any) => setVal("alt_phone", e.target.value)} placeholder="+92 21 0000000" /></Field>
                  <Field label="Email Address" icon={Mail}><TInput value={user.email || ""} readOnly className="bg-white/3 border-white/6 text-white/50 h-9 cursor-not-allowed text-sm" /></Field>
                  <Field label="Website" icon={Globe}><TInput value={form.website || ""} onChange={(e: any) => setVal("website", e.target.value)} placeholder="https://example.com" /></Field>
                  <Field label="Facebook" icon={Facebook}><TInput value={form.facebook || ""} onChange={(e: any) => setVal("facebook", e.target.value)} placeholder="facebook.com/username" /></Field>
                  <Field label="LinkedIn" icon={Linkedin}><TInput value={form.linkedin || ""} onChange={(e: any) => setVal("linkedin", e.target.value)} placeholder="linkedin.com/in/username" /></Field>
                  <Field label="Instagram" icon={Instagram}><TInput value={form.instagram || ""} onChange={(e: any) => setVal("instagram", e.target.value)} placeholder="@handle" /></Field>
                </div>
              </Section>

              <Section title="Address" icon={MapPin} color="violet">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Country" icon={Globe}><TInput value={form.country || ""} onChange={(e: any) => setVal("country", e.target.value)} placeholder="Pakistan" /></Field>
                  <Field label="Province / State" icon={MapPin}><TInput value={form.province || ""} onChange={(e: any) => setVal("province", e.target.value)} placeholder="Punjab" /></Field>
                  <Field label="City" icon={MapPin}><TInput value={form.city || ""} onChange={(e: any) => setVal("city", e.target.value)} placeholder="Lahore" /></Field>
                  <Field label="Area" icon={MapPin}><TInput value={form.area || ""} onChange={(e: any) => setVal("area", e.target.value)} placeholder="Gulberg" /></Field>
                  <Field label="Street Address" icon={MapPin}>
                    <TInput value={form.street_address || ""} onChange={(e: any) => setVal("street_address", e.target.value)} placeholder="House 12, Street 5…" />
                  </Field>
                  <Field label="Postal Code" icon={Hash}><TInput value={form.postal_code || ""} onChange={(e: any) => setVal("postal_code", e.target.value)} placeholder="54000" /></Field>
                </div>
                <Field label="Google Maps Link" icon={Link}>
                  <TInput value={form.google_maps_url || ""} onChange={(e: any) => setVal("google_maps_url", e.target.value)} placeholder="https://maps.google.com/?q=…" />
                </Field>
              </Section>
            </TabsContent>

            {/* ════════════════════════════════════════
                TAB: IDENTITY & BUSINESS
            ════════════════════════════════════════ */}
            <TabsContent value="identity" className="p-5 space-y-4 mt-0">

              <Section title="Identity Verification" icon={IdCard} color="violet">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="CNIC Number (unique)" icon={CreditCard}>
                    <TInput value={form.cnic || ""} onChange={(e: any) => setVal("cnic", e.target.value)} placeholder="35202-1234567-1" maxLength={20}
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-emerald-500/40 h-9 text-sm font-mono" />
                  </Field>
                  <Field label="Passport Number" icon={IdCard}>
                    <TInput value={form.passport_number || ""} onChange={(e: any) => setVal("passport_number", e.target.value)} placeholder="AA0000000 (optional)" />
                  </Field>
                  <Field label="Tax Number (NTN)" icon={Hash}>
                    <TInput value={form.tax_number || ""} onChange={(e: any) => setVal("tax_number", e.target.value)} placeholder="NTN-0000000 (optional)" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <DocUpload label="CNIC Front" userId={user.user_id} fieldKey="cnic_front"
                    currentUrl={form.cnic_image_url} onUploaded={(url) => setVal("cnic_image_url", url)} />
                  <DocUpload label="CNIC Back" userId={user.user_id} fieldKey="cnic_back"
                    currentUrl={form.cnic_back_url} onUploaded={(url) => setVal("cnic_back_url", url)} />
                  <DocUpload label="Selfie Verification" userId={user.user_id} fieldKey="selfie"
                    currentUrl={form.selfie_url} onUploaded={(url) => setVal("selfie_url", url)} />
                </div>
              </Section>

              <Section title="Business Details" icon={Briefcase} color="amber">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Company Registration No." icon={FileText}>
                    <TInput value={form.company_reg_number || ""} onChange={(e: any) => setVal("company_reg_number", e.target.value)} placeholder="SECP-000000" />
                  </Field>
                  <Field label="Business License No." icon={FileText}>
                    <TInput value={form.business_license || ""} onChange={(e: any) => setVal("business_license", e.target.value)} placeholder="BL-000000" />
                  </Field>
                  <Field label="Tax Registration No." icon={FileText}>
                    <TInput value={form.tax_reg_number || ""} onChange={(e: any) => setVal("tax_reg_number", e.target.value)} placeholder="NTN-000000" />
                  </Field>
                  <Field label="Organization Size" icon={Building2}>
                    <TSelect value={form.org_size} onChange={set("org_size")} options={ORG_SIZE_OPTIONS} placeholder="Select size…" />
                  </Field>
                  <Field label="Years in Business" icon={Calendar}>
                    <TInput value={form.years_in_business || ""} onChange={(e: any) => setVal("years_in_business", e.target.value)} placeholder="e.g. 5" type="number" min="0" max="100" />
                  </Field>
                  <Field label="Operating Hours" icon={Clock}>
                    <TInput value={form.operating_hours || ""} onChange={(e: any) => setVal("operating_hours", e.target.value)} placeholder="Mon–Fri 9am–6pm" />
                  </Field>
                </div>
                <Field label="Main Services" icon={Briefcase}>
                  <Textarea value={form.main_services || ""} onChange={(e: any) => setVal("main_services", e.target.value)}
                    placeholder="Courier, freight forwarding, last-mile delivery…" maxLength={300}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-emerald-500/40 resize-none min-h-[64px] text-sm" />
                </Field>
                <Field label="Service Regions" icon={Globe}>
                  <Textarea value={form.service_regions || ""} onChange={(e: any) => setVal("service_regions", e.target.value)}
                    placeholder="Punjab, Sindh, KPK…" maxLength={300}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-emerald-500/40 resize-none min-h-[64px] text-sm" />
                </Field>
              </Section>
            </TabsContent>

            {/* ════════════════════════════════════════
                TAB: BANK
            ════════════════════════════════════════ */}
            <TabsContent value="bank" className="p-5 space-y-4 mt-0">
              <Section title="Bank Information" icon={Landmark} color="emerald" defaultOpen>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Bank Name" icon={Landmark}><TInput value={form.bank_name || ""} onChange={(e: any) => setVal("bank_name", e.target.value)} placeholder="HBL, UBL, MCB…" /></Field>
                  <Field label="Account Title" icon={User}><TInput value={form.account_title || ""} onChange={(e: any) => setVal("account_title", e.target.value)} placeholder="Full account holder name" /></Field>
                  <Field label="Account Number" icon={Hash}>
                    <TInput value={form.account_number || ""} onChange={(e: any) => setVal("account_number", e.target.value)} placeholder="0000-000000000-00"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-emerald-500/40 h-9 text-sm font-mono" />
                  </Field>
                  <Field label="IBAN" icon={Hash}>
                    <TInput value={form.iban || ""} onChange={(e: any) => setVal("iban", e.target.value)} placeholder="PK00HABB0000000000000000"
                      className="bg-white/5 border-white/10 text-white placeholder:text-white/20 focus:border-emerald-500/40 h-9 text-sm font-mono" maxLength={34} />
                  </Field>
                  <Field label="Branch Name" icon={MapPin}><TInput value={form.bank_branch_name || ""} onChange={(e: any) => setVal("bank_branch_name", e.target.value)} placeholder="Main Branch, Lahore" /></Field>
                  <Field label="Branch Code" icon={Hash}><TInput value={form.bank_branch_code || ""} onChange={(e: any) => setVal("bank_branch_code", e.target.value)} placeholder="0000" /></Field>
                </div>
              </Section>

              <Section title="Mobile Wallets" icon={Wallet} color="sky">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="EasyPaisa Number" icon={Phone}><TInput value={form.easypaisa_number || ""} onChange={(e: any) => setVal("easypaisa_number", e.target.value)} placeholder="0300-0000000" /></Field>
                  <Field label="JazzCash Number" icon={Phone}><TInput value={form.jazzcash_number || ""} onChange={(e: any) => setVal("jazzcash_number", e.target.value)} placeholder="0300-0000000" /></Field>
                </div>
                <Field label="Preferred Payment Method" icon={Wallet}>
                  <TSelect value={form.preferred_payment} onChange={set("preferred_payment")} options={PAYMENT_METHODS} placeholder="Select method…" />
                </Field>
              </Section>
            </TabsContent>

            {/* ════════════════════════════════════════
                TAB: DOCUMENTS
                (permission toggles removed — permissions are decided by
                 the login role: admin / staff / partner)
            ════════════════════════════════════════ */}
            <TabsContent value="permissions" className="p-5 space-y-4 mt-0">

              <Section title="Documents" icon={FileText} color="amber">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <DocUpload label="Profile Photo" userId={user.user_id} fieldKey="profile_photo"
                    currentUrl={form.profile_photo_url} onUploaded={(url) => setVal("profile_photo_url", url)} />
                  <DocUpload label="Company Logo" userId={user.user_id} fieldKey="company_logo"
                    currentUrl={form.company_logo_url} onUploaded={(url) => setVal("company_logo_url", url)} />
                  <DocUpload label="Business Registration Certificate" userId={user.user_id} fieldKey="business_cert"
                    currentUrl={form.business_cert_url} onUploaded={(url) => setVal("business_cert_url", url)} />
                  <DocUpload label="Tax Certificate" userId={user.user_id} fieldKey="tax_cert"
                    currentUrl={form.tax_cert_url} onUploaded={(url) => setVal("tax_cert_url", url)} />
                  <DocUpload label="Agreement / Contract" userId={user.user_id} fieldKey="agreement"
                    currentUrl={form.agreement_url} onUploaded={(url) => setVal("agreement_url", url)} />
                </div>
              </Section>
            </TabsContent>

            {/* ════════════════════════════════════════
                TAB: STATS & ACTIVITY
            ════════════════════════════════════════ */}
            <TabsContent value="stats" className="p-5 space-y-4 mt-0">

              <Section title="Statistics" icon={BarChart3} color="emerald">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <StatCard label="Total Agents" value="—" icon={User} color="emerald" />
                  <StatCard label="Active Agents" value="—" icon={CheckCircle2} color="emerald" />
                  <StatCard label="Total Users" value="—" icon={User} color="sky" />
                  <StatCard label="Completed Tasks" value="—" icon={CheckCircle2} color="sky" />
                  <StatCard label="Pending Tasks" value="—" icon={Clock} color="amber" />
                  <StatCard label="Attendance %" value="—" icon={Calendar} color="violet" />
                  <StatCard label="Monthly Revenue" value="—" icon={Wallet} color="emerald" />
                  <StatCard label="Performance Score" value="—" icon={BarChart3} color="amber" />
                </div>
                <p className="text-[11px] text-white/25 text-center">Live stats will appear once linked to agent/task tables.</p>
              </Section>

              <Section title="Activity" icon={Activity} color="sky">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    { label: "Last Login", value: "—" },
                    { label: "Last Active", value: "—" },
                    { label: "Last IP Address", value: "—" },
                    { label: "Device Information", value: "—" },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl bg-white/3 border border-white/8 px-3.5 py-2.5">
                      <p className="text-[11px] text-white/35 uppercase tracking-wider font-semibold">{label}</p>
                      <p className="text-sm text-white mt-0.5">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl bg-white/3 border border-white/8 px-3.5 py-3">
                  <p className="text-[11px] text-white/35 uppercase tracking-wider font-semibold mb-2">Recent Activity Timeline</p>
                  <p className="text-xs text-white/25 py-4 text-center">No activity recorded yet.</p>
                </div>
              </Section>

              <Section title="System" icon={Shield} color="violet">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    { label: "Partner ID", value: partnerProfile?.id || "Not created yet" },
                    { label: "Created At", value: fmt(partnerProfile?.created_at || user.created_at) },
                    { label: "Last Updated", value: fmt(partnerProfile?.updated_at) },
                    { label: "Profile Status", value: form.status?.toUpperCase() || "ACTIVE" },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl bg-white/3 border border-white/8 px-3.5 py-2.5">
                      <p className="text-[11px] text-white/35 uppercase tracking-wider font-semibold">{label}</p>
                      <p className="text-xs text-white/70 mt-0.5 font-mono break-all">{value}</p>
                    </div>
                  ))}
                </div>
              </Section>
            </TabsContent>
          </Tabs>
        </div>

        {/* ── Sticky footer ── */}
        <div className="shrink-0 border-t border-white/8 bg-[#0d1117]/95 backdrop-blur px-5 py-3 flex gap-3">
          <Button variant="outline" className="flex-1 border-white/10 bg-white/5 text-white/60 hover:bg-white/10" onClick={onClose}>
            Cancel
          </Button>
          <Button className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white gap-2" onClick={handleSave} disabled={saving}>
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {saving ? "Saving…" : "Save Profile"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
