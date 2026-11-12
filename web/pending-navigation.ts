import { useEffect } from "react";
import type { TenantIntent } from "./tenant-mutation";
// Lives above the auth screens so an unknown intent remains protected during reauthentication.
export function usePendingNavigation(pending: TenantIntent | null) {
  const locked = !!pending;
  useEffect(() => {
    if (!locked) return;
    const path = location.pathname;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const back = (event: PopStateEvent) => {
      event.stopImmediatePropagation();
      history.pushState(null, "", path);
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener("popstate", back, true);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("popstate", back, true);
    };
  }, [locked]);
}
