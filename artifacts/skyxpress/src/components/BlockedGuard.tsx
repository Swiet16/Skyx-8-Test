// @ts-nocheck
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Lock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Wrap your app root (e.g. App.tsx / Layout.tsx) with this:
 *
 *   <BlockedGuard>
 *     <YourApp />
 *   </BlockedGuard>
 *
 * It watches the logged-in user's profile row and shows a full-screen
 * "Account Suspended" popup on every screen the moment is_blocked
 * flips to true — including live, without a page refresh, via a
 * Supabase realtime subscription.
 *
 * Requires: `profiles` table must have realtime replication enabled
 * in Supabase (Database → Replication → toggle "profiles").
 */
export const BlockedGuard = ({ children }: { children: React.ReactNode }) => {
  const [isBlocked, setIsBlocked] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let channel: any;
    let mounted = true;

    const checkStatus = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        if (mounted) setChecked(true);
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("is_blocked")
        .eq("user_id", user.id)
        .single();

      if (!mounted) return;
      setIsBlocked(!!profile?.is_blocked);
      setChecked(true);

      // Live updates: if an admin blocks this user while they're
      // using the app, the popup appears immediately on every screen.
      channel = supabase
        .channel(`profile-block-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "profiles",
            filter: `user_id=eq.${user.id}`,
          },
          (payload: any) => {
            setIsBlocked(!!payload.new.is_blocked);
          }
        )
        .subscribe();
    };

    checkStatus();

    // Also re-check on auth state changes (login/logout/token refresh)
    const { data: authListener } = supabase.auth.onAuthStateChange(() => {
      checkStatus();
    });

    return () => {
      mounted = false;
      if (channel) supabase.removeChannel(channel);
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  // Avoid a flash of content before the first check resolves
  if (!checked) return null;

  return (
    <>
      {children}

      {isBlocked && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-red-500/20 bg-[#0d1117] p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-red-500/25 bg-red-500/10">
              <Lock className="h-6 w-6 text-red-400" />
            </div>
            <h2 className="mb-2 text-lg font-bold text-white">
              Account Suspended
            </h2>
            <p className="mb-6 text-sm text-white/50">
              Your account has been suspended. Please contact an
              administrator to reactivate access.
            </p>
            <Button
              onClick={handleSignOut}
              variant="destructive"
              className="w-full gap-2"
            >
              <LogOut className="h-4 w-4" /> Sign out
            </Button>
          </div>
        </div>
      )}
    </>
  );
};
