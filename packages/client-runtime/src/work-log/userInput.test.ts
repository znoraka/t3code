import {
  ApprovalRequestId,
  EventId,
  type OrchestrationThreadActivity,
  TurnId,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { foldUserInputActivities } from "./userInput.ts";

const turnId = TurnId.make("turn-1");

function activity(
  input: Partial<OrchestrationThreadActivity> &
    Pick<OrchestrationThreadActivity, "id" | "kind" | "summary">,
): OrchestrationThreadActivity {
  return { tone: "info", payload: {}, turnId, createdAt: "2026-09-11T00:00:00.000Z", ...input };
}

const questionTool = activity({
  id: EventId.make("tool-question"),
  kind: "tool.completed",
  tone: "tool",
  summary: "AskUserQuestion",
  payload: {
    toolCallId: "call-1",
    title: "AskUserQuestion",
    status: "completed",
    data: {
      toolName: "AskUserQuestion",
      input: { questions: [{ question: "Ship it?" }, { question: "Which branch?" }] },
    },
  },
});

const submittedAnswer = activity({
  id: EventId.make("answer"),
  kind: "user-input.answer-submitted",
  summary: "Answered questions",
  payload: {
    requestId: ApprovalRequestId.make("request-1"),
    questionTextById: { q1: "Which branch?", q2: "Ship it?" },
    answers: { q1: "main", q2: "yes" },
    attachmentsByQuestionId: {},
  },
});

describe("foldUserInputActivities", () => {
  const toSorted = Array.prototype.toSorted;

  afterEach(() => {
    Object.defineProperty(Array.prototype, "toSorted", {
      configurable: true,
      value: toSorted,
      writable: true,
    });
  });

  it("drops the native question tool that duplicates a submitted answer", () => {
    const folded = foldUserInputActivities([questionTool, submittedAnswer]);
    expect(folded.map((entry) => entry.id)).toEqual(["answer"]);
    expect(folded[0]?.kind).toBe("user-input.answer-submitted");
  });

  it("folds without Array.prototype.toSorted, which Hermes on mobile lacks", () => {
    // Opening a thread with an answered question crashed the iOS app
    // (TypeError → RCTFatal) because Hermes ships toReversed but not toSorted.
    delete (Array.prototype as { toSorted?: unknown }).toSorted;
    expect(Array.prototype.toSorted).toBeUndefined();

    const folded = foldUserInputActivities([questionTool, submittedAnswer]);
    expect(folded.map((entry) => entry.id)).toEqual(["answer"]);
  });
});
