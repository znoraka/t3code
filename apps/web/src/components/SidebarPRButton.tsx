import { useNavigate } from "@tanstack/react-router";
import { GitPullRequestIcon } from "lucide-react";
import { useCallback } from "react";

import { SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar";

export function SidebarPRButton() {
  const navigate = useNavigate();
  const handleClick = useCallback(() => {
    void navigate({ to: "/pull-requests" });
  }, [navigate]);

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        size="sm"
        className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
        onClick={handleClick}
      >
        <GitPullRequestIcon className="size-3.5" />
        <span className="text-xs">Pull requests</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export default SidebarPRButton;
