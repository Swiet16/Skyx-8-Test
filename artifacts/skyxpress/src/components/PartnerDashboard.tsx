// @ts-nocheck
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Package, ClipboardList, Users, Building2,
  Plus, ArrowRight,
} from "lucide-react";
import { ParcelManagement } from "./ParcelManagement";
import { ManifestStock } from "./ManifestStock";
import { UserManagement } from "./UserManagement";
import { useLiveData } from "@/hooks/useLiveData";

interface PartnerDashboardProps {
  user: any;       // supabase auth user
  profile: any;    // profiles row
}

export const PartnerDashboard = ({ user, profile }: PartnerDashboardProps) => {
  const [activeTab, setActiveTab] = useState("parcels");

  const canManageUsers = !!profile?.can_manage_users;
  const orgName = profile?.company || "Your Organization";

  // Fetch only this partner's parcels for overview stats
  const { data: myParcels } = useLiveData<any>({
    table: "parcels",
    filter: { column: "created_by", value: user?.id },
    orderBy: { column: "created_at", ascending: false },
  });

  const activeParcels = myParcels.filter(
    (p) => !["delivered", "cancelled"].includes(p.current_status),
  );

  // NOTE: Invoices have been removed from the partner dashboard entirely.
  // Invoicing is admin/staff-only now — partners no longer see invoice data,
  // the "Total Invoiced" stat card, or the "My Invoices" tab.

  return (
    <div className="space-y-6">
      {/* Identity banner */}
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-5 py-3">
        <Building2 className="h-5 w-5 text-emerald-400 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-300 truncate">{orgName}</p>
          <p className="text-xs text-emerald-400/60">
            Partner account — you can only view and create your own parcels and manifests.
          </p>
        </div>
      </div>

      {/* Overview cards (invoices removed — parcels + manifests only) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card
          className="cursor-pointer hover:-translate-y-0.5 transition-transform"
          onClick={() => setActiveTab("parcels")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Parcels</CardTitle>
            <Package className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{myParcels.length}</div>
            <p className="text-xs text-muted-foreground">{activeParcels.length} active</p>
          </CardContent>
        </Card>

        <Card
          className="cursor-pointer hover:-translate-y-0.5 transition-transform"
          onClick={() => setActiveTab("manifests")}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Manifests</CardTitle>
            <ClipboardList className="h-4 w-4 text-sky-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">—</div>
            <p className="text-xs text-muted-foreground">View in Manifests tab</p>
          </CardContent>
        </Card>

      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="parcels" className="gap-1.5">
            <Package className="h-3.5 w-3.5" />
            My Parcels
          </TabsTrigger>
          <TabsTrigger value="manifests" className="gap-1.5">
            <ClipboardList className="h-3.5 w-3.5" />
            My Manifests
          </TabsTrigger>
          {canManageUsers && (
            <TabsTrigger value="users" className="gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Users
            </TabsTrigger>
          )}
        </TabsList>

        {/* My Parcels — filtered to this partner only */}
        <TabsContent value="parcels">
          <ParcelManagement filterUserId={user?.id} isPartnerView={true} />
        </TabsContent>

        {/* My Manifests — filtered to this partner's email */}
        <TabsContent value="manifests">
          <ManifestStock filterUserId={user?.id} filterEmail={user?.email} />
        </TabsContent>

        {/* User Management — only if can_manage_users */}
        {canManageUsers && (
          <TabsContent value="users">
            <UserManagement />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
};
