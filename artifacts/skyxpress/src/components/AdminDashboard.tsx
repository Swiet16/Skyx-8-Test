import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Package,
  FileText,
  Plus,
  DollarSign,
  Activity,
  ClipboardCheck,
  ClipboardList,
  Building2,
  TrendingUp,
  TrendingDown,
  Minus,
  LayoutDashboard,
  CheckCircle2,
  ChevronRight,
  Plane,
  Truck,
  MapPin,
  Box,
  Zap,
  Globe2,
  Sparkles,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { UserManagement } from "./UserManagement";
import { ParcelManagement } from "./ParcelManagement";
import { AdminRequestsSection } from "./AdminRequestsSection";
import { ApprovedParcelsSection } from "./ApprovedParcelsSection";
import { ManifestStock } from "./ManifestStock";
import { PartnerManagement } from "./PartnerManagement";
import { useLiveData } from "@/hooks/useLiveData";
import { useTableCount } from "@/hooks/useTableCount";
import {
  FlightPathChart,
  ManifestBar,
  LedgerBars,
  Sparkline,
  lastNDays,
  bucketByDay,
  sumByDay,
  dayLabel,
  pctDelta,
} from "./DashboardCharts";

interface AdminDashboardProps {
  user: any;
  profile: any;
}

// ─── Parcel-style theme tokens ─────────────────────────────────────────────
// Premium courier palette: deep navy + warm amber accent + clean neutrals.
// Same colors used by the boarding-pass stat cards + animated flight ribbon.
const PARCEL_THEME = {
  navy:        "#0F172A", // slate-900 — primary surface
  navyDeep:    "#020617", // slate-950
  amber:       "#F59E0B", // brand accent (parcel tape gold)
  amberLight:  "#FCD34D",
  orange:      "#F97316", // warm secondary
  emerald:     "#10B981", // delivered
  sky:         "#0EA5E9", // in-transit
  violet:      "#8B5CF6", // users
  rose:        "#F43F5E", // alerts
  paper:       "#FFFBEB", // shipping-label paper
  paperDark:   "#FEF3C7",
  ink:         "#1E293B", // label text
  tape:        "rgba(245, 158, 11, 0.18)", // parcel-tape overlay
};

// ─── Role identity ─────────────────────────────────────────────────────────
type RoleKey = "admin" | "staff" | "developer";

const ROLE_THEME: Record<
  RoleKey,
  { label: string; tagline: string; accent: string; badgeClass: string }
> = {
  admin: {
    label: "Admin",
    tagline: "Full manifest access — rates, users, partners & finance",
    accent: PARCEL_THEME.amber,
    badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  },
  staff: {
    label: "Staff",
    tagline: "Ground ops — requests, parcels & quotes",
    accent: PARCEL_THEME.sky,
    badgeClass: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  },
  developer: {
    label: "Developer",
    tagline: "Systems desk — live channels & diagnostics",
    accent: PARCEL_THEME.violet,
    badgeClass: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  },
};

const resolveRole = (rawRole?: string): RoleKey => {
  const r = (rawRole || "").toLowerCase();
  if (r === "admin") return "admin";
  if (r === "developer" || r === "dev" || r === "engineer") return "developer";
  return "staff";
};

// Status hex (kept identical so existing charts still match)
const STATUS_HEX: Record<string, string> = {
  created: "#EAB308",
  picked_up: "#3B82F6",
  in_transit: "#8B5CF6",
  custom_hold: "#EF4444",
  flight_departure: "#6366F1",
  flight_arrived: "#22C55E",
  flight_offload: "#F97316",
  in_custom_clearance: "#EAB308",
  arrived_hub: "#3B82F6",
  customs: "#F97316",
  out_for_delivery: "#6366F1",
  delivered: "#22C55E",
  cancelled: "#EF4444",
};

const METRIC_ACCENT = {
  users:    PARCEL_THEME.violet,
  parcels:  PARCEL_THEME.amber,
  invoices: PARCEL_THEME.sky,
  revenue:  PARCEL_THEME.emerald,
};

const formatRelativeTime = (iso?: string) => {
  if (!iso) return "no activity yet";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// ─── Framer Motion variants ────────────────────────────────────────────────
// Staggered entrance for stat cards so the dashboard "boards itself in".
const containerStagger = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08, delayChildren: 0.05 },
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 18, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 280, damping: 24 },
  },
};

const tabContentVariants = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const } },
  exit:    { opacity: 0, y: -8, transition: { duration: 0.18 } },
};

// ─── Boarding-pass stat card ────────────────────────────────────────────────
// Each top-level metric is rendered as a courier boarding-pass: dashed
// perforation + ticket-stub aesthetic, with a small plane icon that
// glides across on hover.
function BoardingPassCard({
  label,
  value,
  accent,
  icon: Icon,
  delta,
  deltaLabel,
  sparkData,
  index,
  statusPulse,
}: {
  label: string;
  value: string | number;
  accent: string;
  icon: any;
  delta?: number;
  deltaLabel?: string;
  sparkData: number[];
  index: number;
  statusPulse?: { color: string; label: string };
}) {
  return (
    <motion.div
      variants={cardVariants}
      whileHover={{ y: -4, scale: 1.015 }}
      transition={{ type: "spring", stiffness: 300, damping: 22 }}
      className="group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)]"
    >
      {/* Top color band */}
      <div className="h-1.5" style={{ backgroundColor: accent }} />

      {/* Parcel-tape ribbon corner */}
      <div
        className="absolute -right-8 top-3 h-5 w-24 rotate-45 opacity-60"
        style={{ background: `repeating-linear-gradient(45deg, ${accent}40 0 8px, transparent 8px 16px)` }}
      />

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p
              className="text-[10px] font-extrabold uppercase tracking-[0.18em] leading-tight"
              style={{ color: accent }}
            >
              {label}
            </p>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 + index * 0.06, type: "spring", stiffness: 200 }}
              className="mt-2 text-3xl font-black tracking-tight text-slate-900 tabular-nums"
            >
              {value}
            </motion.div>
          </div>

          <div
            className="shrink-0 rounded-xl p-2.5 shadow-sm"
            style={{ backgroundColor: `${accent}1A`, color: accent }}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>

        {/* Delta / status row */}
        <div className="mt-3 flex items-center justify-between gap-2 text-xs">
          {typeof delta === "number" ? (
            <div className="flex items-center gap-1.5">
              {delta > 0 ? (
                <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
              ) : delta < 0 ? (
                <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
              ) : (
                <Minus className="h-3.5 w-3.5 text-slate-400" />
              )}
              <span
                className={`font-semibold tabular-nums ${
                  delta > 0 ? "text-emerald-600" : delta < 0 ? "text-rose-600" : "text-slate-500"
                }`}
              >
                {delta > 0 ? "+" : ""}
                {delta}
                {deltaLabel ? ` ${deltaLabel}` : ""}
              </span>
            </div>
          ) : statusPulse ? (
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
                  style={{ backgroundColor: statusPulse.color }}
                />
                <span
                  className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ backgroundColor: statusPulse.color }}
                />
              </span>
              <span className="font-medium text-slate-600">{statusPulse.label}</span>
            </div>
          ) : null}

          {/* Mini sparkline */}
          {sparkData.length > 0 && (
            <div className="opacity-70 group-hover:opacity-100 transition-opacity">
              <Sparkline data={sparkData} accent={accent} />
            </div>
          )}
        </div>

        {/* Dashed perforation along the bottom — boarding-pass detail */}
        <div
          className="mt-4 h-px w-full"
          style={{
            backgroundImage: `linear-gradient(to right, ${accent}66 50%, transparent 50%)`,
            backgroundSize: "8px 1px",
            backgroundRepeat: "repeat-x",
          }}
        />

        {/* Gliding plane on hover */}
        <motion.div
          className="pointer-events-none absolute -bottom-1 left-0 opacity-0 group-hover:opacity-100"
          initial={false}
          whileHover={{ x: 200 }}
          transition={{ duration: 1.4, ease: "easeInOut" }}
        >
          <Plane className="h-3.5 w-3.5 rotate-45" style={{ color: accent }} />
        </motion.div>
      </div>
    </motion.div>
  );
}

// ─── Animated flight ribbon (decorative top banner) ─────────────────────────
// A subtle dashed flight path with a plane that sweeps across on mount.
// Pure decoration — it sets the parcel/courier tone without distracting.
function FlightRibbon({ accent }: { accent: string }) {
  return (
    <div className="relative h-10 overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-r from-slate-50 via-white to-slate-50">
      {/* Dashed route line */}
      <svg
        className="absolute inset-0 h-full w-full"
        preserveAspectRatio="none"
        viewBox="0 0 1000 40"
        fill="none"
      >
        <path
          d="M0 20 Q 250 5 500 20 T 1000 20"
          stroke={accent}
          strokeWidth="1.5"
          strokeDasharray="6 5"
          opacity="0.4"
        />
        <path
          d="M0 20 Q 250 5 500 20 T 1000 20"
          stroke={accent}
          strokeWidth="1.5"
          strokeDasharray="2 12"
          opacity="0.8"
        />
      </svg>

      {/* Plane sweeping across — runs once on mount */}
      <motion.div
        className="absolute top-1/2 -translate-y-1/2"
        initial={{ x: -40, opacity: 0 }}
        animate={{ x: 1040, opacity: [0, 1, 1, 0] }}
        transition={{ duration: 2.4, ease: "easeInOut", delay: 0.3 }}
      >
        <div
          className="rounded-full p-1.5 shadow-md"
          style={{ backgroundColor: "white", color: accent, border: `1.5px solid ${accent}` }}
        >
          <Plane className="h-3.5 w-3.5 rotate-12" />
        </div>
      </motion.div>

      {/* Origin + destination dots */}
      <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
        <MapPin className="h-3 w-3" style={{ color: accent }} />
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Origin</span>
      </div>
      <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Worldwide</span>
        <Globe2 className="h-3 w-3" style={{ color: accent }} />
      </div>
    </div>
  );
}

// ─── Tracking-timeline status bar ──────────────────────────────────────────
// Replaces the flat ManifestBar with a horizontal "tracking timeline" —
// each status is a connected dot that pulses when active, mimicking the
// customer-facing tracking page aesthetic.
function TrackingTimeline({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div className="space-y-3">
      {/* Segmented bar */}
      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100">
        <AnimatePresence>
          {segments.map((seg, i) => (
            <motion.div
              key={seg.label}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: `${(seg.value / total) * 100}%`, opacity: 1 }}
              transition={{ delay: 0.15 + i * 0.08, duration: 0.5, ease: "easeOut" }}
              style={{ backgroundColor: seg.color }}
              className="h-full first:rounded-l-full last:rounded-r-full"
              title={`${seg.label}: ${seg.value}`}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Legend dots */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {segments.map((seg, i) => (
          <motion.div
            key={seg.label}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + i * 0.05 }}
            className="flex items-center gap-2 text-[11px]"
          >
            <span
              className="relative flex h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: seg.color }}
            >
              <span
                className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-40"
                style={{ backgroundColor: seg.color }}
              />
            </span>
            <span className="font-medium text-slate-600 capitalize truncate flex-1">
              {seg.label.replace(/_/g, " ")}
            </span>
            <span className="font-bold tabular-nums text-slate-800">{seg.value}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────
export const AdminDashboard = ({ user, profile }: AdminDashboardProps) => {
  const { data: users } = useLiveData<any>({
    table: "profiles",
    orderBy: { column: "created_at", ascending: false },
  });

  const { data: parcels } = useLiveData<any>({
    table: "parcels",
    orderBy: { column: "created_at", ascending: false },
  });

  const { data: invoices } = useLiveData<any>({
    table: "invoices",
    orderBy: { column: "created_at", ascending: false },
  });

  const { data: quotes } = useLiveData<any>({
    table: "quotes",
    orderBy: { column: "created_at", ascending: false },
  });

  // Exact counts
  const { count: exactUserCount } = useTableCount("profiles");
  const { count: exactParcelCount } = useTableCount("parcels");
  const { count: exactInvoiceCount } = useTableCount("invoices");
  const { count: exactActiveParcelCount } = useTableCount("parcels", { column: "current_status", value: "in_transit" });

  const [activeTab, setActiveTab] = useState("overview");
  const navigate = useNavigate();

  const role = resolveRole(profile?.role);
  const theme = ROLE_THEME[role];
  const isAdmin = role === "admin";

  // ─── Derived stats ────────────────────────────────────────────────────────
  const stats = {
    totalUsers:     exactUserCount ?? users.length,
    totalParcels:   exactParcelCount ?? parcels.length,
    activeParcels:  exactActiveParcelCount ?? parcels.filter((p: any) => !["delivered", "cancelled"].includes(p.current_status)).length,
    totalInvoices:  exactInvoiceCount ?? invoices.length,
    pendingQuotes:  quotes.filter((q: any) => q.status === "pending").length,
    todayRevenue:   invoices
      .filter((inv: any) => new Date(inv.created_at).toDateString() === new Date().toDateString())
      .reduce((sum: number, inv: any) => sum + (inv.final_amount || 0), 0),
  };

  // ─── Chart data (memoized) ────────────────────────────────────────────────
  const days14 = useMemo(() => lastNDays(14), []);
  const days7  = useMemo(() => lastNDays(7), []);

  const parcelsPerDay14  = useMemo(() => bucketByDay(parcels, "created_at", days14), [parcels, days14]);
  const usersPerDay14    = useMemo(() => bucketByDay(users, "created_at", days14), [users, days14]);
  const invoicesPerDay14 = useMemo(() => bucketByDay(invoices, "created_at", days14), [invoices, days14]);
  const revenuePerDay7   = useMemo(() => sumByDay(invoices, "created_at", "final_amount", days7), [invoices, days7]);

  const parcelsDelta   = useMemo(() => pctDelta(parcelsPerDay14.slice(7), parcelsPerDay14.slice(0, 7)), [parcelsPerDay14]);
  const usersDelta     = useMemo(() => pctDelta(usersPerDay14.slice(7), usersPerDay14.slice(0, 7)), [usersPerDay14]);
  const invoicesDelta  = useMemo(() => pctDelta(invoicesPerDay14.slice(7), invoicesPerDay14.slice(0, 7)), [invoicesPerDay14]);

  const statusSegments = useMemo(() => {
    const counts: Record<string, number> = {};
    parcels.forEach((p: any) => {
      const key = p.current_status || "created";
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([label, value]) => ({ label, value, color: STATUS_HEX[label] || "#94A3B8" }));
  }, [parcels]);

  const day14Labels = days14.map(dayLabel);
  const day7Labels  = days7.map(dayLabel);

  // ─── Nav items ────────────────────────────────────────────────────────────
  const navItems = [
    { tab: "overview",  label: "Overview",         icon: LayoutDashboard, count: null },
    { tab: "requests",  label: "Requests",          icon: ClipboardCheck,  count: stats.pendingQuotes || null },
    { tab: "approved",  label: "Status / Approved", icon: CheckCircle2,    count: null },
    ...(isAdmin
      ? [
          { tab: "users",    label: "Users",    icon: Users,       count: stats.totalUsers || null },
          { tab: "partners", label: "Partners", icon: Building2,   count: null },
        ]
      : []),
    { tab: "parcels",   label: "All Parcels",      icon: Package,         count: stats.totalParcels || null },
    { tab: "manifests", label: "Manifest Stock",   icon: ClipboardList,   count: null },
  ] as const;

  // Stat-card definitions (drives the boarding-pass row)
  const statCards = [
    {
      label: "Total Users",
      value: stats.totalUsers.toLocaleString(),
      accent: METRIC_ACCENT.users,
      icon: Users,
      delta: usersDelta,
      deltaLabel: "% wk",
      sparkData: usersPerDay14.slice(7),
    },
    {
      label: "Total Parcels",
      value: stats.totalParcels.toLocaleString(),
      accent: METRIC_ACCENT.parcels,
      icon: Package,
      delta: parcelsDelta,
      deltaLabel: "% wk",
      sparkData: parcelsPerDay14.slice(7),
      statusPulse: { color: PARCEL_THEME.amber, label: `${stats.activeParcels.toLocaleString()} in transit` },
    },
    {
      label: "Total Invoices",
      value: stats.totalInvoices.toLocaleString(),
      accent: METRIC_ACCENT.invoices,
      icon: FileText,
      delta: invoicesDelta,
      deltaLabel: "% wk",
      sparkData: invoicesPerDay14.slice(7),
    },
    {
      label: "Today's Revenue",
      value: `$${stats.todayRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      accent: METRIC_ACCENT.revenue,
      icon: DollarSign,
      delta: undefined,
      sparkData: revenuePerDay7,
      statusPulse: { color: PARCEL_THEME.emerald, label: `${stats.pendingQuotes} quote${stats.pendingQuotes !== 1 ? "s" : ""} pending` },
    },
  ];

  // Quick-action card definitions (role-based)
  const actionCards: { tab: string; label: string; description: string; icon: any; gradient: string; iconBg: string; iconColor: string }[] =
    isAdmin
      ? [
          {
            tab: "parcels",
            label: "Create / View Parcels",
            description: "Add new shipments or browse the full parcel list",
            icon: Plus,
            gradient: "from-sky-500/15 via-sky-500/5 to-transparent",
            iconBg: "#0EA5E920",
            iconColor: "#0EA5E9",
          },
          {
            tab: "users",
            label: "Manage Users",
            description: "View accounts, assign roles, and manage access",
            icon: Users,
            gradient: "from-violet-500/15 via-violet-500/5 to-transparent",
            iconBg: "#8B5CF620",
            iconColor: "#8B5CF6",
          },
          {
            tab: "manifests",
            label: "Manifest Stock",
            description: "Create, lock, and export flight manifests",
            icon: ClipboardList,
            gradient: "from-amber-500/15 via-amber-500/5 to-transparent",
            iconBg: "#F59E0B20",
            iconColor: "#F59E0B",
          },
        ]
      : role === "staff"
      ? [
          {
            tab: "parcels",
            label: "View All Parcels",
            description: "Browse and update every shipment in the system",
            icon: Package,
            gradient: "from-sky-500/15 via-sky-500/5 to-transparent",
            iconBg: "#0EA5E920",
            iconColor: "#0EA5E9",
          },
          {
            tab: "requests",
            label: "Review Requests",
            description: "Process and approve pending shipment requests",
            icon: ClipboardCheck,
            gradient: "from-teal-500/15 via-teal-500/5 to-transparent",
            iconBg: "#2B8C7E20",
            iconColor: "#2B8C7E",
          },
        ]
      : [
          {
            tab: "parcels",
            label: "View All Parcels",
            description: "Browse and update every shipment in the system",
            icon: Package,
            gradient: "from-sky-500/15 via-sky-500/5 to-transparent",
            iconBg: "#0EA5E920",
            iconColor: "#0EA5E9",
          },
          {
            tab: "approved",
            label: "Status / Approved",
            description: "Track approved parcels and update statuses",
            icon: CheckCircle2,
            gradient: "from-teal-500/15 via-teal-500/5 to-transparent",
            iconBg: "#2B8C7E20",
            iconColor: "#2B8C7E",
          },
        ];

  return (
    <div className="space-y-5">
      {/* ── Animated flight ribbon (decorative top banner) ─────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <FlightRibbon accent={theme.accent} />
      </motion.div>

      {/* ── Mobile nav: horizontal scrollable pills ───────────────────────── */}
      <div className="md:hidden -mx-1 px-1 overflow-x-auto pb-1">
        <div className="flex gap-1.5 w-max">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.tab;
            return (
              <button
                key={item.tab}
                onClick={() => setActiveTab(item.tab)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all duration-150 ${
                  active
                    ? "bg-slate-900 text-white shadow-md"
                    : "border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {item.label}
                {item.count != null && item.count > 0 && (
                  <span className={`rounded-full px-1.5 py-px text-[10px] font-bold ${active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"}`}>
                    {item.count.toLocaleString()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Desktop: content area + right nav sidebar ─────────────────────── */}
      <div className="flex flex-col md:flex-row gap-6 items-start">

        {/* ── Main content ──────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 space-y-6">

          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              variants={tabContentVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
            >

              {/* ════════════════════════════════════════════════════════════ */}
              {/* OVERVIEW TAB                                                   */}
              {/* ════════════════════════════════════════════════════════════ */}
              {activeTab === "overview" && (
                <div className="space-y-6">
                  {/* ---------- Boarding-pass stat cards (staggered) ---------- */}
                  <motion.div
                    variants={containerStagger}
                    initial="hidden"
                    animate="visible"
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
                  >
                    {statCards.map((c, i) => (
                      <BoardingPassCard key={c.label} index={i} {...c} />
                    ))}
                  </motion.div>

                  {/* ---------- Ops board: charts ---------- */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <motion.div
                      variants={cardVariants}
                      initial="hidden"
                      animate="visible"
                      className="lg:col-span-2"
                    >
                      <Card className="overflow-hidden border-slate-200/70 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)]">
                        <CardHeader className="pb-3">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <span
                              className="rounded-lg p-1.5"
                              style={{ backgroundColor: `${theme.accent}1A`, color: theme.accent }}
                            >
                              <Activity className="h-4 w-4" />
                            </span>
                            Parcel Flow — last 14 days
                            <Badge variant="outline" className="ml-auto text-[10px] font-semibold border-slate-200 text-slate-500">
                              <Sparkles className="h-3 w-3 mr-1" /> Live
                            </Badge>
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <FlightPathChart data={parcelsPerDay14} labels={day14Labels} accent={theme.accent} />
                        </CardContent>
                      </Card>
                    </motion.div>

                    <motion.div
                      variants={cardVariants}
                      initial="hidden"
                      animate="visible"
                      transition={{ delay: 0.1 }}
                    >
                      <Card className="overflow-hidden border-slate-200/70 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)] h-full">
                        <CardHeader className="pb-3">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <span
                              className="rounded-lg p-1.5"
                              style={{ backgroundColor: `${theme.accent}1A`, color: theme.accent }}
                            >
                              <ClipboardCheck className="h-4 w-4" />
                            </span>
                            Status Timeline
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          {statusSegments.length > 0 ? (
                            <TrackingTimeline segments={statusSegments} />
                          ) : (
                            <p className="text-sm text-muted-foreground">No parcels yet.</p>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  </div>

                  {/* ---------- Revenue chart (admin only) ---------- */}
                  {isAdmin && (
                    <motion.div
                      variants={cardVariants}
                      initial="hidden"
                      animate="visible"
                      transition={{ delay: 0.15 }}
                    >
                      <Card className="overflow-hidden border-slate-200/70 shadow-[0_8px_30px_-12px_rgba(15,23,42,0.12)]">
                        <CardHeader className="pb-3">
                          <CardTitle className="flex items-center gap-2 text-base">
                            <span
                              className="rounded-lg p-1.5"
                              style={{ backgroundColor: `${METRIC_ACCENT.revenue}1A`, color: METRIC_ACCENT.revenue }}
                            >
                              <DollarSign className="h-4 w-4" />
                            </span>
                            Revenue — last 7 days
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <LedgerBars
                            data={revenuePerDay7}
                            labels={day7Labels}
                            accent={METRIC_ACCENT.revenue}
                            formatValue={(v: number) => `$${v.toFixed(2)}`}
                          />
                        </CardContent>
                      </Card>
                    </motion.div>
                  )}

                  {/* ---------- Quick actions ---------- */}
                  <motion.div
                    variants={cardVariants}
                    initial="hidden"
                    animate="visible"
                    transition={{ delay: 0.2 }}
                  >
                    <div className="mb-3 flex items-center gap-2">
                      <Zap className="h-4 w-4 text-amber-500" />
                      <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">Quick Actions</h3>
                    </div>
                    <div className={`grid grid-cols-1 gap-3 ${actionCards.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
                      {actionCards.map((a, i) => {
                        const Icon = a.icon;
                        return (
                          <motion.button
                            key={a.tab}
                            initial={{ opacity: 0, y: 12 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.25 + i * 0.06, type: "spring", stiffness: 250, damping: 22 }}
                            whileHover={{ y: -3, scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setActiveTab(a.tab)}
                            className={`group relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br ${a.gradient} p-5 text-left shadow-sm transition-shadow hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                          >
                            {/* Decorative plane in corner */}
                            <Plane
                              className="absolute -right-2 -top-2 h-12 w-12 rotate-45 opacity-10 group-hover:opacity-20 group-hover:rotate-12 transition-all duration-500"
                              style={{ color: a.iconColor }}
                            />
                            <div className="flex items-start gap-4 relative">
                              <div
                                className="shrink-0 rounded-xl p-3 shadow-sm transition-transform duration-200 group-hover:scale-110 group-hover:-rotate-6"
                                style={{ backgroundColor: a.iconBg, color: a.iconColor }}
                              >
                                <Icon className="h-5 w-5" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="font-bold text-sm leading-snug text-slate-800">{a.label}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{a.description}</p>
                              </div>
                            </div>
                            <span
                              className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all text-xs font-bold"
                              style={{ color: a.iconColor }}
                            >
                              →
                            </span>
                          </motion.button>
                        );
                      })}
                    </div>
                  </motion.div>
                </div>
              )}

              {/* ════════════════════════════════════════════════════════════ */}
              {/* OTHER TABS — embedded sections                                   */}
              {/* ════════════════════════════════════════════════════════════ */}
              {activeTab === "requests"  && <AdminRequestsSection />}
              {activeTab === "approved"  && <ApprovedParcelsSection />}
              {activeTab === "users"     && isAdmin && <UserManagement />}
              {activeTab === "partners"  && isAdmin && <PartnerManagement />}
              {activeTab === "parcels"   && <ParcelManagement />}
              {activeTab === "manifests" && <ManifestStock />}

            </motion.div>
          </AnimatePresence>

        </div>

        {/* ── Right nav sidebar — desktop only ──────────────────────────── */}
        <aside className="hidden md:flex flex-col w-56 shrink-0 sticky top-4 self-start">
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2, type: "spring", stiffness: 200, damping: 22 }}
            className="rounded-2xl border border-slate-200/70 bg-white shadow-[0_8px_30px_-12px_rgba(15,23,42,0.18)] overflow-hidden"
          >
            {/* Sidebar header — boarding-pass stub aesthetic */}
            <div className="relative px-4 py-3.5 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 overflow-hidden">
              {/* Tape strip */}
              <div
                className="absolute -right-6 top-2 h-4 w-20 rotate-45 opacity-40"
                style={{ background: `repeating-linear-gradient(45deg, ${theme.accent}80 0 6px, transparent 6px 12px)` }}
              />
              <div className="flex items-center gap-2">
                <div
                  className="rounded-lg p-1.5"
                  style={{ backgroundColor: `${theme.accent}30`, color: theme.accent }}
                >
                  <Plane className="h-3.5 w-3.5 rotate-45" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Dashboard</p>
                  <p className="text-xs font-bold text-white mt-0.5 capitalize">{role} Panel</p>
                </div>
              </div>
            </div>

            {/* Nav items */}
            <nav className="p-2 space-y-1">
              {navItems.map((item, i) => {
                const Icon = item.icon;
                const active = activeTab === item.tab;
                return (
                  <motion.button
                    key={item.tab}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.25 + i * 0.04 }}
                    whileHover={{ x: 2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setActiveTab(item.tab)}
                    className={`group relative w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium text-left transition-all duration-150 ${
                      active
                        ? "bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-md"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    }`}
                  >
                    {/* Active indicator bar */}
                    {active && (
                      <motion.span
                        layoutId="active-nav-bar"
                        className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r-full"
                        style={{ backgroundColor: theme.accent }}
                      />
                    )}
                    <div className={`shrink-0 rounded-lg p-1 transition-all ${active ? "bg-white/10" : "group-hover:bg-slate-200/70"}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <span className="flex-1 truncate text-xs">{item.label}</span>
                    {item.count != null && item.count > 0 ? (
                      <span className={`text-[10px] font-bold rounded-full px-1.5 py-px shrink-0 ${active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-600"}`}>
                        {Number(item.count) > 9999 ? "10k+" : Number(item.count).toLocaleString()}
                      </span>
                    ) : active ? (
                      <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
                    ) : null}
                  </motion.button>
                );
              })}
            </nav>

            {/* Footer: live indicator + role badge */}
            <div className="px-3 py-2.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                </span>
                <span className="text-[10px] text-slate-500 font-medium">Live data</span>
              </div>
              <Badge variant="outline" className={`text-[9px] font-bold uppercase tracking-wider ${theme.badgeClass}`}>
                {theme.label}
              </Badge>
            </div>
          </motion.div>

          {/* Decorative parcel-icon stack under the nav */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="mt-4 grid grid-cols-3 gap-2"
          >
            {[
              { icon: Box,      color: PARCEL_THEME.amber,   label: "Box" },
              { icon: Truck,    color: PARCEL_THEME.sky,      label: "Truck" },
              { icon: Plane,    color: PARCEL_THEME.violet,   label: "Air" },
            ].map((d, i) => (
              <motion.div
                key={d.label}
                whileHover={{ y: -3, scale: 1.05 }}
                transition={{ type: "spring", stiffness: 300 }}
                className="flex flex-col items-center gap-1 rounded-xl border border-slate-200/70 bg-white p-2.5 shadow-sm"
              >
                <d.icon className="h-4 w-4" style={{ color: d.color }} />
                <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{d.label}</span>
              </motion.div>
            ))}
          </motion.div>
        </aside>
      </div>
    </div>
  );
};
