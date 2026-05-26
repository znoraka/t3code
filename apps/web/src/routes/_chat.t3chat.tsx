import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useT3ChatAuthStore } from "../t3chatAuthStore";
import { useT3ChatStore } from "../t3chatStore";

function T3ChatSyncLayer() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  useEffect(() => {
    if (search.wos && search.convex) {
      useT3ChatAuthStore.getState().setCredentials(search.wos, search.convex);
      useT3ChatStore.getState().activate();
      void navigate({ to: "/t3chat" as string, replace: true } as any);
    }
  }, [search, navigate]);

  return null;
}

function parseT3ChatSearch(search: Record<string, unknown>): { wos?: string; convex?: string } {
  const wos = typeof search.wos === "string" && search.wos.length > 0 ? search.wos : undefined;
  const convex =
    typeof search.convex === "string" && search.convex.length > 0 ? search.convex : undefined;
  return {
    ...(wos !== undefined ? { wos } : {}),
    ...(convex !== undefined ? { convex } : {}),
  };
}

export const Route = createFileRoute("/_chat/t3chat")({
  component: T3ChatSyncLayer,
  validateSearch: parseT3ChatSearch,
});
