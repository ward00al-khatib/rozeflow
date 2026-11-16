"use client";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase/client";
import { registerDevice, type DeviceStatus } from "./device";

export interface Profile {
  user_id: string;
  display_name: string;
  role: "owner" | "player" | "auditor";
  status: string;
}

export type MemberState =
  | { status: "loading" }
  | { status: "signed_out" }
  | { status: "needs_join"; session: Session }
  | { status: "member"; session: Session; profile: Profile; device: DeviceStatus };

/** Members play with real points only from a device the owner approved (spec appendix ط). */
export function playsReal(member: MemberState): member is Extract<MemberState, { status: "member" }> {
  return member.status === "member" && (member.device === "approved" || member.device === "unknown");
}

/** Current visitor: signed out, invited but not joined yet, or a member with a profile. */
export function useMember(): MemberState & { refresh: () => void } {
  const [state, setState] = useState<MemberState>({ status: "loading" });

  const load = useCallback(async (session: Session | null) => {
    if (!session) return setState({ status: "signed_out" });
    const [{ data }, device] = await Promise.all([
      supabase().from("profiles").select("user_id, display_name, role, status").eq("user_id", session.user.id).maybeSingle(),
      registerDevice(session.access_token),
    ]);
    setState(
      data ? { status: "member", session, profile: data as Profile, device } : { status: "needs_join", session },
    );
  }, []);

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => load(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      void load(session);
    });
    return () => sub.subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(() => {
    supabase().auth.getSession().then(({ data }) => load(data.session));
  }, [load]);

  return { ...state, refresh };
}
