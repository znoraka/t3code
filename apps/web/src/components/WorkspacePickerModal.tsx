"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { scopeProjectRef } from "@t3tools/client-runtime";
import { type ProviderInteractionMode } from "@t3tools/contracts";
import { GitBranchIcon, PlusIcon, SearchIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { getProjectOrderKey } from "../logicalProject";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import type { Project } from "../types";
import { useUiStateStore } from "../uiStateStore";
import { useWorkspacePickerStore } from "../workspacePickerStore";
import { orderItemsByPreferredIds } from "./Sidebar.logic";
import { ProjectFavicon } from "./ProjectFavicon";
import { cn } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorktreeItem {
  id: string;
  project: Project;
  worktreePath: string | null;
  branch: string | null;
  threadCount: number;
}

interface WorkspaceGroup {
  project: Project;
  items: WorktreeItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getWorktreeLabel(worktreePath: string | null, project: Project): string {
  if (worktreePath === null) {
    const parts = project.cwd.replace(/\/$/, "").split(/[/\\]/);
    return parts[parts.length - 1] ?? project.name;
  }
  const parts = worktreePath.replace(/\/$/, "").split(/[/\\]/);
  return parts[parts.length - 1] ?? worktreePath;
}

// ---------------------------------------------------------------------------
// Hook: measure the left edge of the chat area so the modal can be centred
// within the chat pane rather than the full window.
// ---------------------------------------------------------------------------

function useSidebarOffset() {
  const [leftOffset, setLeftOffset] = useState(0);

  useLayoutEffect(() => {
    const update = () => {
      const inset = document.querySelector<HTMLElement>("[data-slot='sidebar-inset']");
      setLeftOffset(inset?.getBoundingClientRect().left ?? 0);
    };

    update();

    const observer = new ResizeObserver(update);
    // Observe the sidebar wrapper (resizes when the rail is dragged) and the
    // inset itself (resizes when the sidebar is toggled open/closed).
    const wrapper = document.querySelector<HTMLElement>("[data-slot='sidebar-wrapper']");
    const inset = document.querySelector<HTMLElement>("[data-slot='sidebar-inset']");
    if (wrapper) observer.observe(wrapper);
    if (inset) observer.observe(inset);

    return () => observer.disconnect();
  }, []);

  return leftOffset;
}

// ---------------------------------------------------------------------------
// Modal shell (handles backdrop, portal, animations)
// ---------------------------------------------------------------------------

export function WorkspacePickerModal() {
  const open = useWorkspacePickerStore((s) => s.open);
  const setOpen = useWorkspacePickerStore((s) => s.setOpen);
  const sidebarOffset = useSidebarOffset();

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-background/60 transition-all duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Viewport
          className="fixed inset-y-0 right-0 z-50 flex flex-col items-center px-4 py-[max(--spacing(4),10vh)]"
          style={{ left: `${sidebarOffset}px` }}
        >
          <DialogPrimitive.Popup className="w-full max-w-[600px] flex flex-col rounded-2xl border bg-popover text-popover-foreground shadow-lg/5 overflow-hidden transition-[scale,opacity] duration-200 data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-2xl)-1px)] before:bg-muted/72 before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]">
            <WorkspacePickerContent setOpen={setOpen} />
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

function WorkspacePickerContent({ setOpen }: { setOpen: (open: boolean) => void }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [interactionMode, setInteractionMode] = useState<ProviderInteractionMode>("default");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { handleNewThread } = useHandleNewThread();
  const projectOrder = useUiStateStore((store) => store.projectOrder);
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const allThreads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));

  const orderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: projects,
        preferredIds: projectOrder,
        getId: getProjectOrderKey,
      }),
    [projects, projectOrder],
  );

  // Derive workspace groups: one WorktreeItem per unique worktreePath per project
  const workspaceGroups = useMemo((): WorkspaceGroup[] => {
    return orderedProjects.map((project) => {
      const projectThreads = allThreads.filter(
        (t) =>
          t.projectId === project.id &&
          t.environmentId === project.environmentId &&
          t.archivedAt === null,
      );

      // Use a map keyed by worktreePath (null = main checkout)
      // Always include the main checkout entry
      const worktreeMap = new Map<
        string | null,
        { branch: string | null; count: number }
      >();
      worktreeMap.set(null, { branch: null, count: 0 });

      for (const thread of projectThreads) {
        const key = thread.worktreePath;
        if (!worktreeMap.has(key)) {
          worktreeMap.set(key, { branch: thread.branch, count: 0 });
        }
        const entry = worktreeMap.get(key)!;
        entry.count++;
        // Prefer a non-null branch
        if (!entry.branch && thread.branch) {
          entry.branch = thread.branch;
        }
      }

      // Sort: main first, then worktrees alphabetically
      const sorted = Array.from(worktreeMap.entries()).sort(([a], [b]) => {
        if (a === null) return -1;
        if (b === null) return 1;
        return a.localeCompare(b);
      });

      const items: WorktreeItem[] = sorted.map(([worktreePath, data]) => ({
        id: `${project.environmentId}:${project.id}:${worktreePath ?? "__main__"}`,
        project,
        worktreePath,
        branch: data.branch,
        threadCount: data.count,
      }));

      return { project, items };
    });
  }, [orderedProjects, allThreads]);

  // Filter groups by search query
  const filteredGroups = useMemo((): WorkspaceGroup[] => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return workspaceGroups;

    return workspaceGroups
      .map((group) => {
        const projectMatches = group.project.name.toLowerCase().includes(query);
        const filteredItems = projectMatches
          ? group.items
          : group.items.filter((item) => {
              const label = getWorktreeLabel(item.worktreePath, item.project).toLowerCase();
              const branchMatch = item.branch?.toLowerCase().includes(query) ?? false;
              return label.includes(query) || branchMatch;
            });
        return { ...group, items: filteredItems };
      })
      .filter((g) => g.items.length > 0);
  }, [workspaceGroups, searchQuery]);

  // Flat ordered list of selectable items for keyboard navigation
  const selectableItems = useMemo(
    () => filteredGroups.flatMap((g) => g.items),
    [filteredGroups],
  );

  const clampedIndex = Math.min(selectedIndex, Math.max(0, selectableItems.length - 1));

  // Focus search on mount
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector<HTMLElement>('[data-selected="true"]');
    selected?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  const handleSelect = useCallback(
    async (item: WorktreeItem) => {
      await handleNewThread(scopeProjectRef(item.project.environmentId, item.project.id), {
        branch: item.branch,
        worktreePath: item.worktreePath,
        envMode: item.worktreePath ? "worktree" : "local",
        interactionMode,
      });
      setOpen(false);
    },
    [handleNewThread, interactionMode, setOpen],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, selectableItems.length - 1));
      } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = selectableItems[clampedIndex];
        if (item) void handleSelect(item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [selectableItems, clampedIndex, handleSelect, setOpen],
  );

  // Build a lookup from item id → flat index for efficient highlight checks
  const itemIndexById = useMemo(() => {
    const map = new Map<string, number>();
    selectableItems.forEach((item, i) => map.set(item.id, i));
    return map;
  }, [selectableItems]);

  return (
    <>
      {/* Search bar */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-border/50">
        <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search workspaces…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* Workspace list */}
      <div ref={listRef} className="overflow-y-auto max-h-[440px] min-h-0">
        {filteredGroups.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No workspaces found
          </div>
        ) : (
          filteredGroups.map((group) => (
            <WorkspaceGroupRow
              key={`${group.project.environmentId}:${group.project.id}`}
              group={group}
              selectedIndex={clampedIndex}
              itemIndexById={itemIndexById}
              onSelect={handleSelect}
              onHover={(item) => {
                const idx = itemIndexById.get(item.id);
                if (idx !== undefined) setSelectedIndex(idx);
              }}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 bg-muted/40">
        {/* Auto / Plan toggle */}
        <div className="flex items-center gap-1 rounded-lg p-0.5 bg-muted">
          <button
            type="button"
            className={cn(
              "px-3 py-1 rounded-md text-sm font-medium transition-colors",
              interactionMode === "default"
                ? "bg-popover text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setInteractionMode("default")}
          >
            Auto
          </button>
          <button
            type="button"
            className={cn(
              "px-3 py-1 rounded-md text-sm font-medium transition-colors",
              interactionMode === "plan"
                ? "bg-popover text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => setInteractionMode("plan")}
          >
            Plan
          </button>
        </div>

        {/* Cancel */}
        <button
          type="button"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WorkspaceGroupRow({
  group,
  selectedIndex,
  itemIndexById,
  onSelect,
  onHover,
}: {
  group: WorkspaceGroup;
  selectedIndex: number;
  itemIndexById: Map<string, number>;
  onSelect: (item: WorktreeItem) => void;
  onHover: (item: WorktreeItem) => void;
}) {
  return (
    <div>
      {/* Project header */}
      <div className="flex items-center gap-2 px-4 py-2 sticky top-0 bg-popover z-10">
        <ProjectFavicon
          environmentId={group.project.environmentId}
          cwd={group.project.cwd}
        />
        <span className="text-xs font-semibold tracking-widest text-muted-foreground uppercase font-mono">
          {group.project.name}
        </span>
      </div>

      {/* Worktree items */}
      {group.items.map((item) => {
        const idx = itemIndexById.get(item.id) ?? -1;
        const isSelected = idx === selectedIndex;
        const label = getWorktreeLabel(item.worktreePath, item.project);

        return (
          <WorktreeRow
            key={item.id}
            item={item}
            label={label}
            isSelected={isSelected}
            onSelect={onSelect}
            onHover={onHover}
          />
        );
      })}

      {/* New worktree stub */}
      <NewWorktreeRow />
    </div>
  );
}

function WorktreeRow({
  item,
  label,
  isSelected,
  onSelect,
  onHover,
}: {
  item: WorktreeItem;
  label: string;
  isSelected: boolean;
  onSelect: (item: WorktreeItem) => void;
  onHover: (item: WorktreeItem) => void;
}) {
  return (
    <div
      data-selected={isSelected}
      className={cn(
        "flex items-center gap-2.5 px-4 py-2 pl-10 cursor-pointer select-none",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted/50",
      )}
      onClick={() => onSelect(item)}
      onMouseEnter={() => onHover(item)}
    >
      <GitBranchIcon
        className={cn(
          "size-3.5 shrink-0",
          isSelected ? "text-accent-foreground/70" : "text-muted-foreground",
        )}
      />
      <span className="text-sm flex-1 min-w-0 truncate font-mono">
        <span className="font-semibold">{label}</span>
        {item.branch && (
          <span
            className={cn(
              isSelected ? "text-accent-foreground/60" : "text-muted-foreground",
            )}
          >
            ({item.branch})
          </span>
        )}
      </span>
      <div className="flex items-center gap-2 shrink-0">
        {isSelected && (
          <span
            className={cn(
              "text-xs",
              isSelected ? "text-accent-foreground/60" : "text-muted-foreground",
            )}
          >
            Enter
          </span>
        )}
        {item.threadCount > 0 && (
          <span
            className={cn(
              "text-xs tabular-nums",
              isSelected ? "text-accent-foreground/60" : "text-muted-foreground",
            )}
          >
            {item.threadCount}
          </span>
        )}
      </div>
    </div>
  );
}

function NewWorktreeRow() {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2 pl-10 cursor-pointer select-none text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
      <PlusIcon className="size-3.5 shrink-0" />
      <span className="text-sm">New worktree</span>
    </div>
  );
}
