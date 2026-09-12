import { useEffect } from "react";
import { supabase } from "../auth/supabase-client";

export function useOrderRealtime(branchId: string, onChange: () => void): void {
  useEffect(() => {
    if (!branchId) {
      return;
    }
    const channel = supabase.channel(`branch:${branchId}`);
    channel.on("broadcast", { event: "*" }, onChange).subscribe((status) => {
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        onChange();
      }
    });
    const refetchOnFocus = (): void => onChange();
    window.addEventListener("focus", refetchOnFocus);
    window.addEventListener("online", refetchOnFocus);
    return () => {
      window.removeEventListener("focus", refetchOnFocus);
      window.removeEventListener("online", refetchOnFocus);
      void supabase.removeChannel(channel);
    };
  }, [branchId, onChange]);
}
