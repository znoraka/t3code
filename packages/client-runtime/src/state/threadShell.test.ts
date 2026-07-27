import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { PrimaryConnectionTarget } from "../connection/model.ts";
import { createEnvironmentSnapshotAtom } from "./snapshots.ts";
import { createEnvironmentThreadShellAtoms } from "./threadShell.ts";
import type { EnvironmentShellState } from "./shell.ts";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");
const PROJECT_ID = ProjectId.make("project-1");

function threadShell(index: number): OrchestrationThreadShell {
  return {
    id: ThreadId.make(`thread-${index}`),
    projectId: PROJECT_ID,
    title: `Thread ${index}`,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  } as OrchestrationThreadShell;
}

function snapshotOf(threads: ReadonlyArray<OrchestrationThreadShell>): OrchestrationShellSnapshot {
  return {
    snapshotSequence: 1,
    projects: [],
    threads,
    updatedAt: "2026-06-01T00:00:00.000Z",
  } as OrchestrationShellSnapshot;
}

function makeHarness(threads: ReadonlyArray<OrchestrationThreadShell>) {
  const state: EnvironmentShellState = {
    snapshot: Option.some(snapshotOf(threads)),
    status: "live",
    error: Option.none(),
  };
  const shellStateAtoms = Atom.family((_environmentId: EnvironmentId) =>
    Atom.make(AsyncResult.success(state)),
  );
  const catalogValueAtom = Atom.make({
    isReady: true,
    entries: new Map([
      [
        ENVIRONMENT_ID,
        {
          target: new PrimaryConnectionTarget({
            environmentId: ENVIRONMENT_ID,
            label: "Environment",
            httpBaseUrl: "https://example.test",
            wsBaseUrl: "wss://example.test",
          }),
          profile: Option.none(),
        },
      ],
    ]),
  });
  return {
    registry: AtomRegistry.make(),
    threadShells: createEnvironmentThreadShellAtoms({
      catalogValueAtom,
      snapshotAtom: createEnvironmentSnapshotAtom(shellStateAtoms),
    }),
  };
}

function nodeLabels(registry: AtomRegistry.AtomRegistry): ReadonlyArray<string> {
  const labels: Array<string> = [];
  for (const [key, node] of registry.getNodes()) {
    const atom = (typeof key === "string" ? node.atom : key) as {
      readonly label?: ReadonlyArray<unknown>;
    };
    const label = atom.label?.[0];
    if (typeof label === "string") {
      labels.push(label);
    }
  }
  return labels;
}

describe("environment thread shell atoms", () => {
  it("does not mount a registry node per thread when reading the whole list", () => {
    // Reading the list used to mount one atom per thread and keep every one of
    // them resident, which dominated the mobile heap and starved the JS thread
    // with garbage collection.
    const threads = Array.from({ length: 200 }, (_, index) => threadShell(index));
    const { registry, threadShells } = makeHarness(threads);

    const shells = registry.get(threadShells.threadShellsAtom);
    expect(shells).toHaveLength(200);

    const perThreadNodes = nodeLabels(registry).filter((label) =>
      label.startsWith("environment-thread-shell:"),
    );
    expect(perThreadNodes).toEqual([]);
    expect(registry.getNodes().size).toBeLessThan(20);
  });

  it("still exposes a single thread without mounting the rest", () => {
    const threads = Array.from({ length: 50 }, (_, index) => threadShell(index));
    const { registry, threadShells } = makeHarness(threads);

    const shell = registry.get(
      threadShells.threadShellAtom({ environmentId: ENVIRONMENT_ID, threadId: threads[3]!.id }),
    );

    expect(shell?.id).toBe(threads[3]!.id);
    const perThreadNodes = nodeLabels(registry).filter((label) =>
      label.startsWith("environment-thread-shell:"),
    );
    expect(perThreadNodes).toHaveLength(1);
  });

  it("keeps scoped object identity for threads whose shell did not change", () => {
    // The per-thread atoms previously provided this memoization. Losing it would
    // make every list update produce all-new row objects and re-render the list.
    const threads = Array.from({ length: 5 }, (_, index) => threadShell(index));
    const { registry, threadShells } = makeHarness(threads);

    const first = registry.get(threadShells.threadShellsAtom);
    const second = registry.get(threadShells.threadShellsAtom);

    expect(second).toBe(first);
    expect(second[0]).toBe(first[0]);
  });
});
