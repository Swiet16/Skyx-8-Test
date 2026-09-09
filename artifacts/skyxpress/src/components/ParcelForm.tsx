// @ts-nocheck
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Package, Plus, Trash2, Search, User, MapPin,
  Phone, Mail, CreditCard, Box, Truck, Globe, FileText,
  DollarSign, Weight, Ruler, ArrowRight, ArrowLeft,
  CheckCircle2, Sparkles, Hash, Building2, ClipboardList,
  Zap, Moon, Leaf, Star,
} from "lucide-react";

// ─── types ───────────────────────────────────────────────────────────────────
interface ParcelFormProps {
  onSuccess: () => void;
  parcel?: any;
  /** ROLE GATE: when true (partner / restricted role editing an existing
   * parcel) the Reference ID and Tracking ID become read-only and are
   * excluded from the update payload, so they can never be changed. */
  lockIdentifiers?: boolean;
}
interface Country { code: string; name: string; continent?: string; }
interface FormData {
  reference_id: string; tracking_id: string;
  created_by_name: string;
  sender_name: string; sender_company: string; sender_phone: string;
  sender_email: string; sender_cnic: string; sender_address: string;
  sender_address_2: string; sender_address_3: string;
  sender_city: string; sender_country: string;
  sender_vat_no: string; sender_eori: string; sender_tax_id: string;
  receiver_name: string; receiver_company: string; receiver_email: string;
  receiver_phone: string; receiver_address: string; receiver_address_2: string;
  receiver_address_3: string; receiver_city: string; receiver_state: string;
  receiver_postal_code: string; receiver_country: string;
  receiver_vat_no: string; receiver_eori: string; receiver_tax_id: string;
  parcel_type: string; weight: string; length: string; width: string; height: string;
  declared_value: string; service_type: string; document_type: string;
  from_country: string; to_country: string; special_instructions: string;
  pieces: number; freight_amount_pkr: string; dim_weight_override: string;
  amount_override: string; currency: string;
  items: Array<{ description: string; quantity: number; unit_price: number; hs_code: string; total: number; }>;
}

const SERVICE_TYPES = [
  { value: "standard", label: "Standard", color: "#3B82F6", desc: "3-5 days" },
  { value: "express", label: "Express", color: "#8B5CF6", desc: "1-2 days" },
  { value: "overnight", label: "Overnight", color: "#F97316", desc: "Next day" },
  { value: "economic", label: "Economic", color: "#22C55E", desc: "7-10 days" },
  { value: "priority", label: "Priority", color: "#EAB308", desc: "Same day" },
  { value: "dhl_pk", label: "DHL PK", color: "#EF4444", desc: "DHL Pakistan" },
  { value: "ups_pk", label: "UPS PK", color: "#C98A2B", desc: "UPS Pakistan" },
  { value: "skynet", label: "SKYNET", color: "#6366F1", desc: "SkyNet" },
  { value: "dpd_uk", label: "DPD UK", color: "#E11D48", desc: "DPD UK" },
  { value: "dhl_via_uk", label: "DHL via UK", color: "#DC2626", desc: "via UK" },
  { value: "ups_via_belfast", label: "UPS via Belfast", color: "#7C3AED", desc: "via Belfast" },
  { value: "ups_saver", label: "UPS Saver", color: "#D97706", desc: "UPS economy" },
];

const PARCEL_TYPES = [
  { value: "box", label: "Box", icon: "📦" },
  { value: "envelope", label: "Envelope", icon: "✉️" },
  { value: "pallet", label: "Pallet", icon: "🏗️" },
  { value: "other", label: "Other", icon: "📫" },
];

// ─── Currencies (40+ major world currencies) ─────────────────────────────────
const CURRENCIES = [
  { code: "USD", label: "USD — US Dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "PKR", label: "PKR — Pakistani Rupee" },
  { code: "AED", label: "AED — UAE Dirham" },
  { code: "SAR", label: "SAR — Saudi Riyal" },
  { code: "QAR", label: "QAR — Qatari Riyal" },
  { code: "KWD", label: "KWD — Kuwaiti Dinar" },
  { code: "BHD", label: "BHD — Bahraini Dinar" },
  { code: "OMR", label: "OMR — Omani Rial" },
  { code: "JOD", label: "JOD — Jordanian Dinar" },
  { code: "INR", label: "INR — Indian Rupee" },
  { code: "CNY", label: "CNY — Chinese Yuan" },
  { code: "JPY", label: "JPY — Japanese Yen" },
  { code: "KRW", label: "KRW — South Korean Won" },
  { code: "AUD", label: "AUD — Australian Dollar" },
  { code: "CAD", label: "CAD — Canadian Dollar" },
  { code: "CHF", label: "CHF — Swiss Franc" },
  { code: "SEK", label: "SEK — Swedish Krona" },
  { code: "NOK", label: "NOK — Norwegian Krone" },
  { code: "DKK", label: "DKK — Danish Krone" },
  { code: "NZD", label: "NZD — New Zealand Dollar" },
  { code: "SGD", label: "SGD — Singapore Dollar" },
  { code: "HKD", label: "HKD — Hong Kong Dollar" },
  { code: "ZAR", label: "ZAR — South African Rand" },
  { code: "TRY", label: "TRY — Turkish Lira" },
  { code: "RUB", label: "RUB — Russian Ruble" },
  { code: "BRL", label: "BRL — Brazilian Real" },
  { code: "MXN", label: "MXN — Mexican Peso" },
  { code: "MYR", label: "MYR — Malaysian Ringgit" },
  { code: "THB", label: "THB — Thai Baht" },
  { code: "IDR", label: "IDR — Indonesian Rupiah" },
  { code: "PHP", label: "PHP — Philippine Peso" },
  { code: "VND", label: "VND — Vietnamese Dong" },
  { code: "EGP", label: "EGP — Egyptian Pound" },
  { code: "NGN", label: "NGN — Nigerian Naira" },
  { code: "KES", label: "KES — Kenyan Shilling" },
  { code: "GHS", label: "GHS — Ghanaian Cedi" },
  { code: "BDT", label: "BDT — Bangladeshi Taka" },
  { code: "LKR", label: "LKR — Sri Lankan Rupee" },
  { code: "NPR", label: "NPR — Nepalese Rupee" },
  { code: "PLN", label: "PLN — Polish Zloty" },
  { code: "CZK", label: "CZK — Czech Koruna" },
  { code: "HUF", label: "HUF — Hungarian Forint" },
  { code: "RON", label: "RON — Romanian Leu" },
  { code: "ILS", label: "ILS — Israeli Shekel" },
];

// ─── STEP CONFIG ─────────────────────────────────────────────────────────────
const STEPS = [
  { id: 0, label: "Shipment", icon: Hash, color: "#C98A2B" },
  { id: 1, label: "Sender", icon: User, color: "#8B5CF6" },
  { id: 2, label: "Receiver", icon: MapPin, color: "#3B82F6" },
  { id: 3, label: "Package", icon: Package, color: "#F97316" },
  { id: 4, label: "Contents", icon: ClipboardList, color: "#22C55E" },
];

// ─── UI Atoms ────────────────────────────────────────────────────────────────
const Field = ({
  label, required, children, hint,
}: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) => (
  <div className="space-y-1.5">
    <label className="flex items-center gap-1 text-xs font-medium text-white/55 uppercase tracking-wide">
      {label}
      {required && <span className="text-[#C98A2B]">*</span>}
    </label>
    {children}
    {hint && <p className="text-[10px] text-white/25">{hint}</p>}
  </div>
);

const StyledInput = ({ className = "", ...props }: any) => (
  <Input
    {...props}
    className={`h-9 bg-white/5 border-white/10 text-white placeholder:text-white/25
      focus:border-white/25 focus:bg-white/8 transition-all ${className}`}
  />
);

const StyledSelect = ({ value, onValueChange, placeholder, children }: any) => (
  <Select value={value} onValueChange={onValueChange}>
    <SelectTrigger className="h-9 bg-white/5 border-white/10 text-white">
      <SelectValue placeholder={placeholder} />
    </SelectTrigger>
    <SelectContent className="bg-[#0f1020] border-white/10 text-white">
      {children}
    </SelectContent>
  </Select>
);

const CountrySelect = ({ value, onValueChange, countries, loading }: any) => (
  <StyledSelect value={value} onValueChange={onValueChange}
    placeholder={loading ? "Loading…" : "Select country"}>
    {countries.map((c: Country) => (
      <SelectItem key={c.code} value={c.code} className="text-white text-sm">{c.name}</SelectItem>
    ))}
  </StyledSelect>
);

// ─── Stepper Header ───────────────────────────────────────────────────────────
const StepBar = ({ step, total, steps }: { step: number; total: number; steps: typeof STEPS }) => (
  <div className="flex items-center justify-between relative">
    {/* connector line */}
    <div className="absolute left-0 right-0 top-5 h-px bg-white/8 z-0" />
    <div
      className="absolute left-0 top-5 h-px bg-gradient-to-r from-[#C98A2B] to-[#8B5CF6] z-0 transition-all duration-500"
      style={{ width: `${(step / (total - 1)) * 100}%` }}
    />
    {steps.map((s, i) => {
      const done = i < step;
      const active = i === step;
      const Icon = s.icon;
      return (
        <div key={s.id} className="relative z-10 flex flex-col items-center gap-1.5">
          <motion.div
            animate={{ scale: active ? 1.15 : 1 }}
            className={`h-10 w-10 rounded-xl flex items-center justify-center border transition-all ${
              done
                ? "bg-emerald-500/20 border-emerald-500/40"
                : active
                ? "border-[#C98A2B]/60"
                : "bg-white/4 border-white/10"
            }`}
            style={active ? { background: `${s.color}18`, borderColor: `${s.color}50` } : {}}
          >
            {done ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            ) : (
              <Icon className="h-4 w-4" style={{ color: active ? s.color : "rgba(255,255,255,0.3)" }} />
            )}
          </motion.div>
          <span className={`text-[10px] font-medium ${active ? "text-white" : done ? "text-emerald-400" : "text-white/30"}`}>
            {s.label}
          </span>
        </div>
      );
    })}
  </div>
);

// ─── Section card ─────────────────────────────────────────────────────────────
const SectionCard = ({
  title, icon: Icon, color, children,
}: { title: string; icon: any; color: string; children: React.ReactNode }) => (
  <motion.div
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -8 }}
    transition={{ duration: 0.25 }}
    className="rounded-2xl overflow-hidden"
    style={{
      border: `1px solid ${color}20`,
      background: `linear-gradient(135deg, ${color}08 0%, rgba(255,255,255,0.02) 60%)`,
      boxShadow: `0 0 40px ${color}08`,
    }}
  >
    {/* Header */}
    <div
      className="flex items-center gap-3 px-5 py-3.5 border-b"
      style={{
        borderColor: `${color}15`,
        background: `linear-gradient(90deg, ${color}12, transparent)`,
      }}
    >
      <div
        className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: `${color}20`, boxShadow: `0 0 12px ${color}20` }}
      >
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <span className="text-sm font-bold text-white tracking-wide">{title}</span>
      <div className="ml-auto h-px flex-1 max-w-16" style={{ background: `linear-gradient(to right, ${color}30, transparent)` }} />
    </div>
    <div className="p-3 sm:p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
      {children}
    </div>
  </motion.div>
);

// ─── Quick-fill search dropdown ───────────────────────────────────────────────
const QuickFill = ({
  value, onChange, onBlur, searching, results, onSelect, placeholder,
}: any) => (
  <div className="relative col-span-2">
    <div className="relative">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/25" />
      <StyledInput
        placeholder={placeholder}
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        onFocus={() => onChange(value)}
        onBlur={onBlur}
        className="pl-9 pr-3 border-dashed"
        autoComplete="off"
      />
      {searching && (
        <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-white/30" />
      )}
    </div>
    <AnimatePresence>
      {results.length > 0 && value.trim().length >= 2 && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          className="absolute z-30 w-full mt-1 rounded-xl border border-white/10 bg-[#0f1020] shadow-xl overflow-hidden"
        >
          {results.map((row: any, i: number) => (
            <button
              key={i}
              type="button"
              onMouseDown={() => onSelect(row)}
              className="w-full text-left px-4 py-2.5 hover:bg-white/8 border-b border-white/6 last:border-0 transition-colors"
            >
              <p className="text-sm text-white font-medium">{row.sender_name || row.receiver_name}</p>
              <p className="text-[11px] text-white/40">
                {row.sender_phone || row.receiver_phone}
                {(row.sender_city || row.receiver_city) ? ` · ${row.sender_city || row.receiver_city}` : ""}
              </p>
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

// ─── Service type card selector ──────────────────────────────────────────────

// Lucide icons for generic service types
const SERVICE_LUCIDE: Record<string, { icon: React.ElementType; bg: string }> = {
  standard:  { icon: Truck,  bg: "#3B82F6" },
  express:   { icon: Zap,    bg: "#8B5CF6" },
  overnight: { icon: Moon,   bg: "#F97316" },
  economic:  { icon: Leaf,   bg: "#22C55E" },
  priority:  { icon: Star,   bg: "#EAB308" },
};

// Inline brand badges for courier carriers — no network required
const SERVICE_BADGE: Record<string, { text: string; bg: string; fg: string; accent?: string }> = {
  dhl_pk:          { text: "DHL",  bg: "#D40511", fg: "#FFCC00" },
  dhl_via_uk:      { text: "DHL",  bg: "#D40511", fg: "#FFCC00" },
  ups_pk:          { text: "UPS",  bg: "#301506", fg: "#FFB500" },
  ups_via_belfast: { text: "UPS",  bg: "#301506", fg: "#FFB500" },
  ups_saver:       { text: "UPS",  bg: "#301506", fg: "#FFB500" },
  skynet:          { text: "SKY",  bg: "#0052CC", fg: "#FFFFFF" },
  dpd_uk:          { text: "DPD",  bg: "#DC0032", fg: "#FFFFFF" },
};

const ServiceIcon = ({ serviceValue }: { serviceValue: string }) => {
  const badge = SERVICE_BADGE[serviceValue];
  if (badge) {
    return (
      <div
        className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 overflow-hidden"
        style={{ background: badge.bg }}
      >
        <span style={{
          color: badge.fg,
          fontSize: 8,
          fontWeight: 900,
          letterSpacing: 0.3,
          lineHeight: 1,
          fontFamily: "Arial, sans-serif",
        }}>
          {badge.text}
        </span>
      </div>
    );
  }
  const lucide = SERVICE_LUCIDE[serviceValue];
  if (!lucide) return null;
  const Icon = lucide.icon;
  return (
    <div
      className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0"
      style={{ background: `${lucide.bg}22`, border: `1px solid ${lucide.bg}40` }}
    >
      <Icon className="h-3.5 w-3.5" style={{ color: lucide.bg }} />
    </div>
  );
};

const ServicePicker = ({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) => (
  <div className="col-span-2 grid grid-cols-2 md:grid-cols-3 gap-2.5">
    {SERVICE_TYPES.map((s) => {
      const active = value === s.value;
      return (
        <motion.button
          key={s.value}
          type="button"
          onClick={() => onChange(s.value)}
          whileHover={{ scale: 1.03, y: -1 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className="relative rounded-xl border text-left overflow-hidden transition-colors duration-200"
          style={{
            borderColor: active ? `${s.color}60` : "rgba(255,255,255,0.07)",
            background: active ? `${s.color}14` : "rgba(255,255,255,0.03)",
            boxShadow: active ? `0 0 18px 0 ${s.color}22, inset 0 0 0 1px ${s.color}30` : "none",
          }}
        >
          {/* colour accent strip */}
          <div
            className="absolute left-0 top-0 h-full w-1 rounded-l-xl transition-opacity"
            style={{ background: s.color, opacity: active ? 1 : 0.25 }}
          />
          <div className="pl-3 pr-3 py-2.5">
            <div className="flex items-center gap-2 mb-0.5">
              <ServiceIcon serviceValue={s.value} />
              <p
                className="text-xs font-bold leading-none transition-colors"
                style={{ color: active ? s.color : "rgba(255,255,255,0.75)" }}
              >
                {s.label}
              </p>
            </div>
            <p className="text-[10px] text-white/35 mt-1.5 pl-9">{s.desc}</p>
          </div>
          {active && (
            <motion.div
              layoutId="service-active-dot"
              className="absolute top-2 right-2 h-1.5 w-1.5 rounded-full"
              style={{ background: s.color }}
            />
          )}
        </motion.button>
      );
    })}
  </div>
);

// ─── Document / Non-Document toggle ──────────────────────────────────────────
const DocTypePicker = ({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) => {
  const opts = [
    { value: "document",     label: "Document",     emoji: "📄", desc: "Letters, certificates, papers", color: "#3B82F6" },
    { value: "non-document", label: "Non-Document", emoji: "📦", desc: "Goods, merchandise, gifts",      color: "#F97316" },
  ];
  return (
    <div className="col-span-2 grid grid-cols-2 gap-3">
      {opts.map((o) => {
        const active = value === o.value;
        return (
          <motion.button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            whileTap={{ scale: 0.97 }}
            className="relative rounded-xl border p-3.5 text-left overflow-hidden transition-all duration-200 flex items-center gap-3"
            style={{
              borderColor: active ? `${o.color}50` : "rgba(255,255,255,0.07)",
              background: active ? `${o.color}12` : "rgba(255,255,255,0.03)",
              boxShadow: active ? `0 0 20px 0 ${o.color}14, inset 0 0 0 1px ${o.color}25` : "none",
            }}
          >
            {/* Left accent bar */}
            <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l-xl transition-opacity"
              style={{ background: o.color, opacity: active ? 1 : 0 }} />
            <motion.span
              animate={{ scale: active ? 1.1 : 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className="text-2xl leading-none shrink-0 pl-1"
            >
              {o.emoji}
            </motion.span>
            <div>
              <p className="text-sm font-bold transition-colors leading-tight"
                style={{ color: active ? o.color : "rgba(255,255,255,0.8)" }}>
                {o.label}
              </p>
              <p className="text-[11px] text-white/35 mt-0.5">{o.desc}</p>
            </div>
            {active && (
              <motion.div layoutId="doc-check"
                className="ml-auto h-4 w-4 rounded-full flex items-center justify-center shrink-0"
                style={{ background: o.color }}>
                <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </motion.div>
            )}
          </motion.button>
        );
      })}
    </div>
  );
};

// ─── Parcel type pill ─────────────────────────────────────────────────────────
const TypePicker = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
  <div className="col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
    {PARCEL_TYPES.map((t) => {
      const active = value === t.value;
      return (
        <motion.button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          whileHover={{ scale: 1.05, y: -2 }}
          whileTap={{ scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 20 }}
          className="relative rounded-2xl border py-4 text-center overflow-hidden transition-all duration-200"
          style={{
            borderColor: active ? "rgba(249,115,22,0.55)" : "rgba(255,255,255,0.07)",
            background: active
              ? "radial-gradient(ellipse at 50% 0%, rgba(249,115,22,0.18), rgba(249,115,22,0.06) 80%)"
              : "rgba(255,255,255,0.03)",
            boxShadow: active ? "0 0 20px 0 rgba(249,115,22,0.18)" : "none",
          }}
        >
          {active && (
            <motion.div
              layoutId="type-glow"
              className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-3/4 rounded-full"
              style={{ background: "linear-gradient(90deg, transparent, #F97316, transparent)" }}
            />
          )}
          <motion.div
            animate={{ scale: active ? 1.2 : 1 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
            className="text-2xl leading-none mb-1.5"
          >
            {t.icon}
          </motion.div>
          <div className={`text-[11px] font-semibold transition-colors ${active ? "text-[#F97316]" : "text-white/45"}`}>
            {t.label}
          </div>
        </motion.button>
      );
    })}
  </div>
);

// ─── Main Form ────────────────────────────────────────────────────────────────
export const ParcelForm = ({ onSuccess, parcel, lockIdentifiers = false }: ParcelFormProps) => {
  const isEdit = !!parcel;
  // Identifiers (Reference / Tracking IDs) are locked when a restricted role
  // (e.g. partner) edits an existing parcel. Creating a new parcel is still
  // allowed — IDs are auto-generated there anyway.
  const idsLocked = lockIdentifiers && isEdit;
  const { toast } = useToast();
  const [step, setStep] = useState(0);
  const [countries, setCountries] = useState<Country[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [trackingIdLoading, setTrackingIdLoading] = useState(false);
  const [referenceIdLoading, setReferenceIdLoading] = useState(false);
  // Tracks whether the user has manually typed/edited the reference_id
  // since the form opened. If they have NOT touched it, we let the
  // backend consume the sequence on save. If they HAVE touched it,
  // we honor their value as-is (and skip consuming a sequence number).
  const referenceIdTouched = useRef(false);
  const [createdByLoading, setCreatedByLoading] = useState(false);

  const [formData, setFormData] = useState<FormData>({
    reference_id: parcel?.reference_id || "",
    tracking_id: parcel?.tracking_id || "",
    created_by_name: parcel?.created_by_name || "",
    sender_name: parcel?.sender_name || "",
    sender_company: parcel?.sender_company || "",
    sender_phone: parcel?.sender_phone || "",
    sender_email: parcel?.sender_email || "",
    sender_cnic: parcel?.sender_cnic || "",
    sender_address: parcel?.sender_address || "",
    sender_address_2: parcel?.sender_address_2 || "",
    sender_address_3: parcel?.sender_address_3 || "",
    sender_city: parcel?.sender_city || "",
    sender_country: parcel?.sender_country || "",
    sender_vat_no: parcel?.sender_vat_no || "",
    sender_eori: parcel?.sender_eori || "",
    sender_tax_id: parcel?.sender_tax_id || "",
    receiver_name: parcel?.receiver_name || "",
    receiver_company: parcel?.receiver_company || "",
    receiver_email: parcel?.receiver_email || "",
    receiver_phone: parcel?.receiver_phone || "",
    receiver_address: parcel?.receiver_address || "",
    receiver_address_2: parcel?.receiver_address_2 || "",
    receiver_address_3: parcel?.receiver_address_3 || "",
    receiver_city: parcel?.receiver_city || "",
    receiver_state: parcel?.receiver_state || "",
    receiver_postal_code: parcel?.receiver_postal_code || "",
    receiver_country: parcel?.receiver_country || "",
    receiver_vat_no: parcel?.receiver_vat_no || "",
    receiver_eori: parcel?.receiver_eori || "",
    receiver_tax_id: parcel?.receiver_tax_id || "",
    parcel_type: parcel?.parcel_type || "box",
    weight: parcel?.weight?.toString() || "",
    length: parcel?.length?.toString() || "",
    width: parcel?.width?.toString() || "",
    height: parcel?.height?.toString() || "",
    declared_value: parcel?.declared_value?.toString() || "",
    service_type: parcel?.service_type || "standard",
    document_type: parcel?.document_type || "document",
    from_country: parcel?.from_country || "",
    to_country: parcel?.to_country || "",
    special_instructions: parcel?.special_instructions || "",
    pieces: parcel?.pieces || 1,
    freight_amount_pkr: parcel?.freight_amount_pkr?.toString() || "",
    dim_weight_override: parcel?.dim_weight_override?.toString() || "",
    amount_override: parcel?.amount_override?.toString() || "",
    currency: parcel?.currency || "USD",
    items: parcel?.items?.length
      ? parcel.items
      : [{ description: "", quantity: 1, unit_price: 0, hs_code: "", total: 0 }],
  });

  // Quick fill states
  const [senderSearch, setSenderSearch] = useState("");
  const [senderResults, setSenderResults] = useState<any[]>([]);
  const [senderSearching, setSenderSearching] = useState(false);
  const [receiverSearch, setReceiverSearch] = useState("");
  const [receiverResults, setReceiverResults] = useState<any[]>([]);
  const [receiverSearching, setReceiverSearching] = useState(false);

  // Load countries
  useEffect(() => {
    supabase.from("countries").select("code, name, continent").order("name").then(({ data }) => {
      setCountries(data || []);
      setCountriesLoading(false);
    });
  }, []);

  // Auto-generate tracking ID
  useEffect(() => {
    if (isEdit) return;
    setTrackingIdLoading(true);
    supabase.rpc("generate_numeric_tracking").then(({ data, error }) => {
      if (!error && data) setFormData((prev) => prev.tracking_id ? prev : { ...prev, tracking_id: data });
      setTrackingIdLoading(false);
    });
  }, []);

  // Preview Reference ID (does NOT consume the sequence — safe to call every
  // time the form opens; the number only actually advances when the parcel
  // is saved, in handleSubmit)
  useEffect(() => {
    if (isEdit) return;
    setReferenceIdLoading(true);
    supabase.rpc("peek_sequential_reference").then(({ data, error }) => {
      if (!error && data) setFormData((prev) => prev.reference_id ? prev : { ...prev, reference_id: data });
      setReferenceIdLoading(false);
    });
  }, []);

  // Auto-fill "Created By" from the current user's profile. Only runs for
  // new parcels — when editing, we keep showing the original creator's name
  // that was stored on the parcel at creation time.
  useEffect(() => {
    if (isEdit) return;
    setCreatedByLoading(true);
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setCreatedByLoading(false); return; }
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("user_id", session.user.id)
        .single();
      if (profile?.full_name) {
        setFormData((prev) => prev.created_by_name ? prev : { ...prev, created_by_name: profile.full_name });
      }
      setCreatedByLoading(false);
    });
  }, []);

  // Debounced sender search
  useEffect(() => {
    if (senderSearch.trim().length < 2) { setSenderResults([]); return; }
    const t = setTimeout(async () => {
      setSenderSearching(true);
      const { data } = await supabase.from("parcels")
        .select("sender_name,sender_company,sender_phone,sender_email,sender_cnic,sender_address,sender_city,sender_country,sender_vat_no,sender_eori,sender_tax_id")
        .or(`sender_name.ilike.%${senderSearch}%,sender_phone.ilike.%${senderSearch}%`)
        .order("created_at", { ascending: false }).limit(8);
      if (data) {
        const seen = new Set<string>();
        setSenderResults(data.filter((r: any) => {
          const k = `${r.sender_name}|${r.sender_phone}`; if (seen.has(k)) return false; seen.add(k); return true;
        }));
      }
      setSenderSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [senderSearch]);

  // Debounced receiver search
  useEffect(() => {
    if (receiverSearch.trim().length < 2) { setReceiverResults([]); return; }
    const t = setTimeout(async () => {
      setReceiverSearching(true);
      const { data } = await supabase.from("parcels")
        .select("receiver_name,receiver_company,receiver_phone,receiver_email,receiver_address,receiver_city,receiver_state,receiver_postal_code,receiver_country,receiver_vat_no,receiver_eori,receiver_tax_id")
        .or(`receiver_name.ilike.%${receiverSearch}%,receiver_phone.ilike.%${receiverSearch}%`)
        .order("created_at", { ascending: false }).limit(8);
      if (data) {
        const seen = new Set<string>();
        setReceiverResults(data.filter((r: any) => {
          const k = `${r.receiver_name}|${r.receiver_phone}`; if (seen.has(k)) return false; seen.add(k); return true;
        }));
      }
      setReceiverSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [receiverSearch]);

  const set = (field: keyof FormData, value: any) => setFormData((prev) => ({ ...prev, [field]: value }));

  const fillSender = (row: any) => {
    setFormData((prev) => ({ ...prev, sender_name: row.sender_name || "", sender_company: row.sender_company || "", sender_phone: row.sender_phone || "", sender_email: row.sender_email || "", sender_cnic: row.sender_cnic || "", sender_address: row.sender_address || "", sender_city: row.sender_city || "", sender_country: row.sender_country || "", sender_vat_no: row.sender_vat_no || "", sender_eori: row.sender_eori || "", sender_tax_id: row.sender_tax_id || "" }));
    setSenderSearch(""); setSenderResults([]);
    toast({ title: "Sender filled", description: "Details copied from a previous parcel." });
  };

  const fillReceiver = (row: any) => {
    setFormData((prev) => ({ ...prev, receiver_name: row.receiver_name || "", receiver_company: row.receiver_company || "", receiver_phone: row.receiver_phone || "", receiver_email: row.receiver_email || "", receiver_address: row.receiver_address || "", receiver_city: row.receiver_city || "", receiver_state: row.receiver_state || "", receiver_postal_code: row.receiver_postal_code || "", receiver_country: row.receiver_country || "", receiver_vat_no: row.receiver_vat_no || "", receiver_eori: row.receiver_eori || "", receiver_tax_id: row.receiver_tax_id || "" }));
    setReceiverSearch(""); setReceiverResults([]);
    toast({ title: "Receiver filled", description: "Details copied from a previous parcel." });
  };

  const setItem = (i: number, field: string, value: any) => {
    const items = [...formData.items];
    items[i] = { ...items[i], [field]: value };
    if (field === "quantity" || field === "unit_price") {
      items[i].total = items[i].quantity * items[i].unit_price;
    }
    set("items", items);
  };

  const subtotal = formData.items.reduce((s, it) => s + it.total, 0);

  const describeDupError = (msg?: string) => {
    if (!msg) return "One of the values you entered is already in use.";
    if (msg.includes("tracking_id")) return "That Tracking ID is already taken.";
    if (msg.includes("reference_id")) return "That Reference ID is already taken.";
    return "A duplicate value was detected.";
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { toast({ title: "Session expired", variant: "destructive" }); setIsLoading(false); return; }

      const { data: profile } = await supabase.from("profiles").select("partner_id, office_id").eq("user_id", session.user.id).single();

      // Determine the final reference_id. If the user manually typed a
      // non-empty value, honor it as-is. Otherwise, consume the backend
      // sequence now to lock in the real id. This also avoids burning a
      // sequence number when the user overrides it, and guarantees no
      // numbers are skipped just because someone opened and closed the form.
      let finalReferenceId = formData.reference_id;
      const userOverrodeRef =
        !isEdit &&
        referenceIdTouched.current &&
        typeof finalReferenceId === "string" &&
        finalReferenceId.trim().length > 0;
      if (!isEdit && !userOverrodeRef) {
        const { data: genRef, error: genRefError } = await supabase.rpc("generate_sequential_reference");
        if (!genRefError && genRef) finalReferenceId = genRef;
      }

      const payload: any = {
        ...formData,
        reference_id: finalReferenceId,
        weight: parseFloat(formData.weight) || null,
        length: parseFloat(formData.length) || null,
        width: parseFloat(formData.width) || null,
        height: parseFloat(formData.height) || null,
        declared_value: parseFloat(formData.declared_value) || null,
        freight_amount_pkr: parseFloat(formData.freight_amount_pkr) || null,
        dim_weight_override: parseFloat(formData.dim_weight_override) || null,
        amount_override: parseFloat(formData.amount_override) || null,
        partner_id: profile?.partner_id || null,
        office_id: profile?.office_id || null,
        created_by: session.user.id,
      };

      if (isEdit) {
        delete payload.created_by;
        // ROLE GATE: partners cannot change Reference / Tracking IDs —
        // exclude them from the update so the DB keeps the original values.
        if (lockIdentifiers) {
          delete payload.reference_id;
          delete payload.tracking_id;
        }
        const { error } = await supabase.from("parcels").update(payload).eq("id", parcel.id);
        if (error) throw error;
        toast({ title: "Parcel updated ✓" });
      } else {
        const { error } = await supabase.from("parcels").insert(payload);
        if (error) {
          if (error.code === "23505") {
            toast({ title: "Duplicate value", description: describeDupError(error.message), variant: "destructive" });
            setIsLoading(false); return;
          }
          throw error;
        }
        toast({ title: "Parcel created! 🎉", description: `Tracking: ${formData.tracking_id}` });
      }
      onSuccess();
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "Something went wrong.", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  // ─── Step content renderers ─────────────────────────────────────────────────
  const renderStep0 = () => (
    <SectionCard title="Shipment Details" icon={Hash} color="#C98A2B">
      <Field label="Tracking ID" required hint={idsLocked ? "Locked — your role cannot change this" : undefined}>
        <div className="relative">
          <StyledInput
            value={formData.tracking_id}
            onChange={(e: any) => set("tracking_id", e.target.value)}
            placeholder={trackingIdLoading ? "Generating…" : "Auto-generated"}
            className={`font-mono ${idsLocked ? "opacity-70 cursor-not-allowed select-none" : ""}`}
            readOnly={idsLocked}
          />
          {trackingIdLoading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-white/30" />
          )}
        </div>
      </Field>
      <Field label="Reference ID" hint={idsLocked ? "Locked — your role cannot change this" : "Locked in only when you save"}>
        <div className="relative">
          <StyledInput
            value={formData.reference_id}
            onChange={(e: any) => {
              if (idsLocked) return; // ROLE GATE: ignore edits for restricted roles
              referenceIdTouched.current = true;
              set("reference_id", e.target.value);
            }}
            placeholder={referenceIdLoading ? "Generating…" : "Auto-generated"}
            className={`font-mono ${idsLocked ? "opacity-70 cursor-not-allowed select-none" : ""}`}
            readOnly={idsLocked}
          />
          {referenceIdLoading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-white/30" />
          )}
        </div>
      </Field>
      <Field label="Created By" hint="Printed as the AWB account name">
        <div className="relative">
          <StyledInput
            value={formData.created_by_name}
            onChange={(e: any) => set("created_by_name", e.target.value)}
            placeholder={createdByLoading ? "Loading…" : "Auto-filled from your profile"}
          />
          {createdByLoading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-white/30" />
          )}
        </div>
      </Field>
      <Field label="Pieces">
        <StyledInput type="number" min={1} value={formData.pieces} onChange={(e: any) => set("pieces", parseInt(e.target.value) || 1)} />
      </Field>
      <div className="col-span-2">
        <Field label="Shipment Type">
          <DocTypePicker value={formData.document_type} onChange={(v) => set("document_type", v)} />
        </Field>
      </div>
      <div className="col-span-2">
        <Field label="Service Type">
          <ServicePicker value={formData.service_type} onChange={(v) => set("service_type", v)} />
        </Field>
      </div>
    </SectionCard>
  );

  const renderStep1 = () => (
    <SectionCard title="Sender Information" icon={User} color="#8B5CF6">
      <QuickFill
        value={senderSearch}
        onChange={setSenderSearch}
        onBlur={() => setTimeout(() => setSenderResults([]), 200)}
        searching={senderSearching}
        results={senderResults}
        onSelect={fillSender}
        placeholder="Quick-fill from previous parcel…"
      />
      <Field label="Full Name" required>
        <StyledInput value={formData.sender_name} onChange={(e: any) => set("sender_name", e.target.value)} placeholder="John Smith" />
      </Field>
      <Field label="Company">
        <StyledInput value={formData.sender_company} onChange={(e: any) => set("sender_company", e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Phone" required>
        <StyledInput type="tel" value={formData.sender_phone} onChange={(e: any) => set("sender_phone", e.target.value)} placeholder="+92 300 0000000" />
      </Field>
      <Field label="Email" required>
        <StyledInput type="email" value={formData.sender_email} onChange={(e: any) => set("sender_email", e.target.value)} placeholder="john@email.com" />
      </Field>
      <Field label="CNIC">
        <StyledInput value={formData.sender_cnic} onChange={(e: any) => set("sender_cnic", e.target.value)} placeholder="1234567890123" />
      </Field>
      <Field label="City" required>
        <StyledInput value={formData.sender_city} onChange={(e: any) => set("sender_city", e.target.value)} placeholder="Lahore" />
      </Field>
      <Field label="Country" required>
        <CountrySelect value={formData.sender_country} onValueChange={(v: string) => set("sender_country", v)} countries={countries} loading={countriesLoading} />
      </Field>
      <Field label="VAT No.">
        <StyledInput value={formData.sender_vat_no} onChange={(e: any) => set("sender_vat_no", e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="EORI">
        <StyledInput value={formData.sender_eori} onChange={(e: any) => set("sender_eori", e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Tax ID">
        <StyledInput value={formData.sender_tax_id} onChange={(e: any) => set("sender_tax_id", e.target.value)} placeholder="Optional" />
      </Field>
      <div className="col-span-2">
        <Field label="Address" required>
          <textarea
            value={formData.sender_address}
            onChange={(e) => set("sender_address", e.target.value)}
            rows={2}
            placeholder="Street address"
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 resize-none"
          />
        </Field>
      </div>
      <Field label="Address Line 2">
        <StyledInput value={formData.sender_address_2} onChange={(e: any) => set("sender_address_2", e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Address Line 3">
        <StyledInput value={formData.sender_address_3} onChange={(e: any) => set("sender_address_3", e.target.value)} placeholder="Optional" />
      </Field>
    </SectionCard>
  );

  const renderStep2 = () => (
    <SectionCard title="Receiver Information" icon={MapPin} color="#3B82F6">
      <QuickFill
        value={receiverSearch}
        onChange={setReceiverSearch}
        onBlur={() => setTimeout(() => setReceiverResults([]), 200)}
        searching={receiverSearching}
        results={receiverResults}
        onSelect={fillReceiver}
        placeholder="Quick-fill from previous parcel…"
      />
      <Field label="Full Name" required>
        <StyledInput value={formData.receiver_name} onChange={(e: any) => set("receiver_name", e.target.value)} placeholder="Jane Doe" />
      </Field>
      <Field label="Company">
        <StyledInput value={formData.receiver_company} onChange={(e: any) => set("receiver_company", e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Phone" required>
        <StyledInput type="tel" value={formData.receiver_phone} onChange={(e: any) => set("receiver_phone", e.target.value)} placeholder="+44 7700 900000" />
      </Field>
      <Field label="Email">
        <StyledInput type="email" value={formData.receiver_email} onChange={(e: any) => set("receiver_email", e.target.value)} placeholder="jane@email.com" />
      </Field>
      <Field label="City" required>
        <StyledInput value={formData.receiver_city} onChange={(e: any) => set("receiver_city", e.target.value)} placeholder="London" />
      </Field>
      <Field label="State / Province">
        <StyledInput value={formData.receiver_state} onChange={(e: any) => set("receiver_state", e.target.value)} placeholder="England" />
      </Field>
      <Field label="Postal Code">
        <StyledInput value={formData.receiver_postal_code} onChange={(e: any) => set("receiver_postal_code", e.target.value)} placeholder="SW1A 1AA" />
      </Field>
      <Field label="Country" required>
        <CountrySelect value={formData.receiver_country} onValueChange={(v: string) => set("receiver_country", v)} countries={countries} loading={countriesLoading} />
      </Field>
      <Field label="VAT No.">
        <StyledInput value={formData.receiver_vat_no} onChange={(e: any) => set("receiver_vat_no", e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="EORI">
        <StyledInput value={formData.receiver_eori} onChange={(e: any) => set("receiver_eori", e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Tax ID">
        <StyledInput value={formData.receiver_tax_id} onChange={(e: any) => set("receiver_tax_id", e.target.value)} placeholder="Optional" />
      </Field>
      <div className="col-span-2">
        <Field label="Address" required>
          <textarea
            value={formData.receiver_address}
            onChange={(e) => set("receiver_address", e.target.value)}
            rows={2}
            placeholder="Street address"
            className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 resize-none"
          />
        </Field>
      </div>
      <Field label="Address Line 2">
        <StyledInput value={formData.receiver_address_2} onChange={(e: any) => set("receiver_address_2", e.target.value)} placeholder="Optional" />
      </Field>
      <Field label="Address Line 3">
        <StyledInput value={formData.receiver_address_3} onChange={(e: any) => set("receiver_address_3", e.target.value)} placeholder="Optional" />
      </Field>
    </SectionCard>
  );

  const renderStep3 = () => {
    const w = parseFloat(formData.weight) || 0;
    const l = parseFloat(formData.length) || 0;
    const wi = parseFloat(formData.width) || 0;
    const h = parseFloat(formData.height) || 0;
    const volWeight = l * wi * h / 5000;
    const chargeable = Math.max(w, volWeight);
    return (
      <SectionCard title="Package Details" icon={Package} color="#F97316">
        <div className="col-span-2">
          <Field label="Package Type">
            <TypePicker value={formData.parcel_type} onChange={(v) => set("parcel_type", v)} />
          </Field>
        </div>
        <Field label="Weight (kg)" required hint="Actual weight">
          <StyledInput type="number" step="0.1" value={formData.weight} onChange={(e: any) => set("weight", e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Pieces">
          <StyledInput type="number" min={1} value={formData.pieces} onChange={(e: any) => set("pieces", parseInt(e.target.value) || 1)} />
        </Field>
        <Field label="Length (cm)">
          <StyledInput type="number" step="0.1" value={formData.length} onChange={(e: any) => set("length", e.target.value)} placeholder="0" />
        </Field>
        <Field label="Width (cm)">
          <StyledInput type="number" step="0.1" value={formData.width} onChange={(e: any) => set("width", e.target.value)} placeholder="0" />
        </Field>
        <Field label="Height (cm)">
          <StyledInput type="number" step="0.1" value={formData.height} onChange={(e: any) => set("height", e.target.value)} placeholder="0" />
        </Field>
        <Field label="Currency" hint="Applies to declared value & freight">
          <StyledSelect value={formData.currency} onValueChange={(v: string) => set("currency", v)} placeholder="Select currency">
            {CURRENCIES.map((c) => (
              <SelectItem key={c.code} value={c.code} className="text-white text-sm">{c.label}</SelectItem>
            ))}
          </StyledSelect>
        </Field>
        <Field label={`Declared Value (${formData.currency})`}>
          <StyledInput type="number" step="0.01" value={formData.declared_value} onChange={(e: any) => set("declared_value", e.target.value)} placeholder="0.00" />
        </Field>
        <Field label={`Freight (${formData.currency})`} hint={`Amount in ${formData.currency}`}>
          <StyledInput type="number" step="0.01" value={formData.freight_amount_pkr} onChange={(e: any) => set("freight_amount_pkr", e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Dim Weight Override">
          <StyledInput type="number" step="0.01" value={formData.dim_weight_override} onChange={(e: any) => set("dim_weight_override", e.target.value)} placeholder="Auto" />
        </Field>
        <Field label={`Amount Override (${formData.currency})`}>
          <StyledInput type="number" step="0.01" value={formData.amount_override} onChange={(e: any) => set("amount_override", e.target.value)} placeholder="Auto" />
        </Field>
        <Field label="Origin Country">
          <CountrySelect value={formData.from_country} onValueChange={(v: string) => set("from_country", v)} countries={countries} loading={countriesLoading} />
        </Field>
        <Field label="Destination Country">
          <CountrySelect value={formData.to_country} onValueChange={(v: string) => set("to_country", v)} countries={countries} loading={countriesLoading} />
        </Field>
        {/* Weight summary */}
        {(w > 0 || volWeight > 0) && (
          <div className="col-span-2 rounded-xl border border-[#F97316]/20 bg-[#F97316]/8 p-3 grid grid-cols-3 gap-3">
            {[
              { label: "Actual", value: `${w.toFixed(2)} kg` },
              { label: "Volumetric", value: `${volWeight.toFixed(2)} kg` },
              { label: "Chargeable", value: `${chargeable.toFixed(2)} kg` },
            ].map(({ label, value }) => (
              <div key={label} className="text-center">
                <p className="text-xs text-white/40">{label}</p>
                <p className="text-sm font-bold text-[#F97316]">{value}</p>
              </div>
            ))}
          </div>
        )}
        <div className="col-span-2">
          <Field label="Special Instructions">
            <textarea
              value={formData.special_instructions}
              onChange={(e) => set("special_instructions", e.target.value)}
              rows={2}
              placeholder="Fragile, Handle with care, etc."
              className="w-full rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-white/25 resize-none"
            />
          </Field>
        </div>
      </SectionCard>
    );
  };

  const renderStep4 = () => (
    <SectionCard title="Contents Declaration" icon={ClipboardList} color="#22C55E">
      <div className="col-span-2 space-y-3">
        {formData.items.map((item, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-white/8 bg-white/3 p-3 grid grid-cols-12 gap-2 items-end"
          >
            {/* Description */}
            <div className="col-span-12 sm:col-span-4 space-y-1">
              <label className="text-[10px] text-white/35 uppercase tracking-wide">Description</label>
              <StyledInput value={item.description} onChange={(e: any) => setItem(i, "description", e.target.value)} placeholder="e.g. Electronics" />
            </div>
            {/* Qty */}
            <div className="col-span-3 sm:col-span-2 space-y-1">
              <label className="text-[10px] text-white/35 uppercase tracking-wide">Qty</label>
              <StyledInput type="number" min={1} value={item.quantity} onChange={(e: any) => setItem(i, "quantity", parseInt(e.target.value) || 1)} />
            </div>
            {/* Unit Price */}
            <div className="col-span-4 sm:col-span-2 space-y-1">
              <label className="text-[10px] text-white/35 uppercase tracking-wide">Unit $</label>
              <StyledInput type="number" step="0.01" value={item.unit_price} onChange={(e: any) => setItem(i, "unit_price", parseFloat(e.target.value) || 0)} />
            </div>
            {/* HS Code */}
            <div className="col-span-4 sm:col-span-2 space-y-1">
              <label className="text-[10px] text-white/35 uppercase tracking-wide">HS Code</label>
              <StyledInput value={item.hs_code} onChange={(e: any) => setItem(i, "hs_code", e.target.value)} placeholder="Optional" />
            </div>
            {/* Total */}
            <div className="col-span-4 sm:col-span-1 space-y-1">
              <label className="text-[10px] text-white/35 uppercase tracking-wide">Total</label>
              <div className="h-9 flex items-center text-sm font-semibold text-[#22C55E]">
                ${item.total.toFixed(2)}
              </div>
            </div>
            {/* Delete */}
            <div className="col-span-1 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  if (formData.items.length > 1) set("items", formData.items.filter((_, j) => j !== i));
                }}
                disabled={formData.items.length === 1}
                className="h-9 w-9 rounded-lg flex items-center justify-center text-red-400/50 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-20 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        ))}

        {/* Add item */}
        <button
          type="button"
          onClick={() => set("items", [...formData.items, { description: "", quantity: 1, unit_price: 0, hs_code: "", total: 0 }])}
          className="w-full rounded-xl border border-dashed border-white/15 py-2.5 text-xs text-white/35 hover:text-white/60 hover:border-white/25 transition-all flex items-center justify-center gap-2"
        >
          <Plus className="h-3.5 w-3.5" /> Add Item
        </button>

        {/* Subtotal */}
        <div className="flex justify-end">
          <div className="rounded-xl border border-[#22C55E]/20 bg-[#22C55E]/8 px-5 py-2.5 flex items-center gap-3">
            <span className="text-xs text-white/40">Items Subtotal</span>
            <span className="text-lg font-bold text-[#22C55E]">${subtotal.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </SectionCard>
  );

  return (
    <div className="bg-[#0b0d1a] text-white" style={{ fontFamily: "system-ui, sans-serif" }}>

      {/* ── Sticky section nav ── */}
      <div className="sticky top-0 z-20 bg-[#0b0d1a]/96 backdrop-blur-md border-b border-white/8 px-5 py-2.5">
        <div className="flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
          {STEPS.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() =>
                  document
                    .getElementById(`parcel-section-${s.id}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all hover:bg-white/8 flex-shrink-0"
                style={{ color: s.color }}
              >
                <Icon className="h-3 w-3" />
                {s.label}
              </button>
            );
          })}
          <div className="ml-auto flex-shrink-0">
            <span className="text-[10px] text-white/25 font-medium uppercase tracking-wider">
              {isEdit ? "Edit Parcel" : "New Parcel"}
            </span>
          </div>
        </div>
      </div>

      {/* ── All sections ── */}
      <div className="p-3 sm:p-5 space-y-5">

        {/* Shipment Details */}
        <div id="parcel-section-0">
          {renderStep0()}
        </div>

        {/* Sender + Receiver side by side */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          <div id="parcel-section-1">{renderStep1()}</div>
          <div id="parcel-section-2">{renderStep2()}</div>
        </div>

        {/* Package Details */}
        <div id="parcel-section-3">
          {renderStep3()}
        </div>

        {/* Contents Declaration */}
        <div id="parcel-section-4">
          {renderStep4()}
        </div>

        {/* ── Submit row ── */}
        <div className="flex items-center justify-between pt-3 border-t border-white/8">
          <p className="text-xs text-white/25">
            All fields marked <span className="text-[#C98A2B]">*</span> are required
          </p>
          <Button
            onClick={handleSubmit}
            disabled={isLoading}
            className="gap-2 bg-[#C98A2B] hover:bg-[#B8791A] text-white border-none min-w-40 h-10"
          >
            {isLoading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
            ) : (
              <><Sparkles className="h-4 w-4" /> {isEdit ? "Update Parcel" : "Create Parcel"}</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
