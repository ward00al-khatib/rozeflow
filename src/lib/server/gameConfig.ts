"use client";
/**
 * Live game settings from the server. The owner sets the RTP per game in the control panel; a change
 * is a new config version that applies to new rounds at once (spec appendix ح). Visitors read it too,
 * so demo play shows the same multipliers as real play. If the server cannot be reached, the bundled
 * config is used.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabase/client";

export interface ConfigVersionRow {
  game_id: string;
  version: number;
  status: string;
  config_json: { payout_model?: { target_rtp_bp?: number } } & Record<string, unknown>;
  effective_at: string | null;
  change_reason: string | null;
}

export function rtpOf(row: Pick<ConfigVersionRow, "config_json">): number | null {
  const bp = row.config_json?.payout_model?.target_rtp_bp;
  return typeof bp === "number" && Number.isSafeInteger(bp) ? bp : null;
}

export const fmtRtp = (bp: number) => (bp / 100).toFixed(2).replace(/\.?0+$/, "");

export async function fetchActiveConfig(gameId: string): Promise<ConfigVersionRow | null> {
  const { data, error } = await supabase()
    .from("game_config_versions")
    .select("game_id, version, status, config_json, effective_at, change_reason")
    .eq("game_id", gameId)
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (error || !data) return null;
  return data as ConfigVersionRow;
}

/** The bundled config with the server's live RTP and version applied. */
export function useLiveConfig<C extends { config_version: number; payout_model: { target_rtp_bp: number } }>(
  gameId: string,
  bundled: C,
): { config: C; live: boolean; refresh: () => void } {
  const [state, setState] = useState<{ config: C; live: boolean }>({ config: bundled, live: false });

  const refresh = useCallback(() => {
    fetchActiveConfig(gameId)
      .then((row) => {
        const bp = row && rtpOf(row);
        if (!row || !bp) return;
        setState((s) =>
          s.live && s.config.config_version === row.version
            ? s
            : {
                live: true,
                config: { ...bundled, config_version: row.version, payout_model: { ...bundled.payout_model, target_rtp_bp: bp } },
              },
        );
      })
      .catch(() => undefined);
  }, [gameId, bundled]);

  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  return { ...state, refresh };
}
