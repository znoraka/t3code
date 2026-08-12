import type { ApprovalRequestId } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { useKeyboardState } from "react-native-keyboard-controller";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { useThemeColor } from "../../lib/useThemeColor";
import {
  hasPendingUserInputAnswer,
  type PendingUserInput,
  type PendingUserInputDraftAnswer,
} from "../../lib/threadActivity";

export interface PendingUserInputCardProps {
  readonly pendingUserInput: PendingUserInput;
  readonly drafts: Record<string, PendingUserInputDraftAnswer>;
  readonly answers: Record<string, string> | null;
  readonly respondingUserInputId: ApprovalRequestId | null;
  readonly onSelectOption: (
    requestId: ApprovalRequestId,
    questionId: string,
    label: string,
  ) => void;
  readonly onChangeCustomAnswer: (
    requestId: ApprovalRequestId,
    questionId: string,
    customAnswer: string,
  ) => void;
  readonly onSubmit: () => Promise<unknown>;
}

/** Never let the question body eat the whole screen: the card floats over the
 * feed with no scroll of its own, so anything taller than this is unreachable
 * (it overflows past the top of the window, not into a scrollable area). The
 * budget is a share of what the keyboard leaves, since the card rides above it
 * whenever the custom-answer field is focused. */
const MAX_BODY_HEIGHT_RATIO = 0.45;
const MIN_BODY_HEIGHT = 160;

export function PendingUserInputCard(props: PendingUserInputCardProps) {
  const questions = props.pendingUserInput.questions;
  const windowHeight = useWindowDimensions().height;
  const keyboardHeight = useKeyboardState((state) => (state.isVisible ? state.height : 0));
  const chevronColor = useThemeColor("--color-icon-subtle");
  const [collapsed, setCollapsed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const total = questions.length;
  // A late-arriving payload can shrink the question list under the cursor.
  const currentIndex = Math.min(stepIndex, Math.max(0, total - 1));
  const question = questions[currentIndex];
  if (!question) {
    return null;
  }

  const answeredCount = questions.filter((entry) =>
    hasPendingUserInputAnswer(props.drafts[entry.id]),
  ).length;
  const draft = props.drafts[question.id];
  const currentAnswered = hasPendingUserInputAnswer(draft);
  const isLastStep = currentIndex === total - 1;
  const submitting = props.respondingUserInputId === props.pendingUserInput.requestId;
  const firstUnansweredIndex = questions.findIndex(
    (entry) => !hasPendingUserInputAnswer(props.drafts[entry.id]),
  );

  // The surface is opaque on purpose: the card floats over the thread feed
  // with no blur behind it, so a translucent background renders the questions
  // on top of whatever message happens to sit underneath.
  const surfaceClassName =
    "rounded-[20px] border border-neutral-200 bg-neutral-100 dark:border-white/6 dark:bg-neutral-900";

  // Collapsed is the escape hatch for the reason the card exists: answering
  // often needs the agent's message, which the expanded card covers.
  if (collapsed) {
    return (
      <Pressable
        className={cn("flex-row items-center gap-3 px-4 py-3", surfaceClassName)}
        onPress={() => setCollapsed(false)}
      >
        <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-sky-700 dark:text-sky-300">
          User input needed
        </Text>
        <Text className="font-sans text-xs text-neutral-500 dark:text-neutral-400">
          {answeredCount}/{total} answered
        </Text>
        <View className="flex-1" />
        <Text className="font-t3-bold text-sm text-sky-700 dark:text-sky-300">Answer</Text>
        <SymbolView name="chevron.up" size={12} tintColor={chevronColor} type="monochrome" />
      </Pressable>
    );
  }

  return (
    <View className={cn("gap-2.5 p-4", surfaceClassName)}>
      <View className="flex-row items-center gap-2">
        <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-sky-700 dark:text-sky-300">
          User input needed
        </Text>
        {total > 1 ? (
          <Text className="font-sans text-2xs uppercase tracking-[1.1px] text-neutral-500 dark:text-neutral-500">
            {currentIndex + 1} of {total}
          </Text>
        ) : null}
        <View className="flex-1" />
        <Pressable
          className="-my-1 flex-row items-center gap-1 py-1 pl-3 active:opacity-60"
          hitSlop={8}
          onPress={() => setCollapsed(true)}
        >
          <Text className="font-t3-bold text-xs text-neutral-500 dark:text-neutral-400">Hide</Text>
          <SymbolView name="chevron.down" size={11} tintColor={chevronColor} type="monochrome" />
        </Pressable>
      </View>

      <ScrollView
        className="shrink"
        style={{
          maxHeight: Math.max(
            MIN_BODY_HEIGHT,
            Math.round((windowHeight - keyboardHeight) * MAX_BODY_HEIGHT_RATIO),
          ),
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-2">
          <Text className="font-t3-bold text-xs uppercase tracking-[1px] text-neutral-500 dark:text-neutral-500">
            {question.header}
          </Text>
          <Text className="font-sans text-base leading-snug text-neutral-950 dark:text-neutral-50">
            {question.question}
          </Text>
          <View className="gap-2">
            {question.options.map((option) => {
              const selected =
                draft?.selectedOptionLabel === option.label && !draft.customAnswer?.trim().length;
              return (
                <Pressable
                  key={option.label}
                  className={cn(
                    "gap-1 rounded-2xl border px-3.5 py-3",
                    selected
                      ? "border-blue-300/50 bg-blue-50 dark:border-blue-400/28 dark:bg-blue-400/14"
                      : "border-neutral-200 bg-white dark:border-white/6 dark:bg-neutral-950/70",
                  )}
                  onPress={() =>
                    props.onSelectOption(
                      props.pendingUserInput.requestId,
                      question.id,
                      option.label,
                    )
                  }
                >
                  <Text
                    className={cn(
                      "font-t3-bold text-sm",
                      selected
                        ? "text-sky-700 dark:text-sky-300"
                        : "text-neutral-600 dark:text-neutral-300",
                    )}
                  >
                    {option.label}
                  </Text>
                  <Text className="font-sans text-xs leading-snug text-neutral-500 dark:text-neutral-400">
                    {option.description}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            value={draft?.customAnswer ?? ""}
            onChangeText={(value) =>
              props.onChangeCustomAnswer(props.pendingUserInput.requestId, question.id, value)
            }
            placeholder="Or type a custom answer"
            className="min-h-[54px] rounded-2xl border border-neutral-200 bg-white px-3.5 py-3 font-sans text-base text-neutral-950 dark:border-white/8 dark:bg-neutral-950/70 dark:text-neutral-50"
          />
        </View>
      </ScrollView>

      <View className="flex-row items-center gap-2 pt-0.5">
        {currentIndex > 0 ? (
          <Pressable
            className="items-center justify-center rounded-2xl bg-neutral-200 px-4 py-3.5 dark:bg-neutral-800"
            onPress={() => setStepIndex(currentIndex - 1)}
          >
            <Text className="font-t3-bold text-sm text-neutral-950 dark:text-neutral-50">Back</Text>
          </Pressable>
        ) : null}
        {total > 1 ? (
          <View className="flex-row items-center gap-1.5 px-1">
            {questions.map((entry, index) => (
              <Pressable key={entry.id} hitSlop={6} onPress={() => setStepIndex(index)}>
                <View
                  className={cn(
                    "size-2 rounded-full",
                    index === currentIndex
                      ? "bg-sky-600 dark:bg-sky-300"
                      : hasPendingUserInputAnswer(props.drafts[entry.id])
                        ? "bg-sky-600/35 dark:bg-sky-300/40"
                        : "bg-neutral-300 dark:bg-neutral-700",
                  )}
                />
              </Pressable>
            ))}
          </View>
        ) : null}
        <View className="flex-1" />
        {isLastStep ? (
          <PrimaryAction
            // On the last step an unanswered question elsewhere would otherwise
            // dead-end at a disabled submit with no hint where the gap is.
            label={props.answers ? "Submit answers" : "Go to unanswered"}
            enabled={props.answers ? !submitting : firstUnansweredIndex >= 0}
            onPress={() => {
              if (props.answers) {
                void props.onSubmit();
                return;
              }
              if (firstUnansweredIndex >= 0) {
                setStepIndex(firstUnansweredIndex);
              }
            }}
          />
        ) : (
          <PrimaryAction
            label="Next"
            enabled={currentAnswered}
            onPress={() => setStepIndex(currentIndex + 1)}
          />
        )}
      </View>
    </View>
  );
}

function PrimaryAction(props: {
  readonly label: string;
  readonly enabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      className={cn(
        "items-center justify-center rounded-2xl px-5 py-3.5",
        props.enabled ? "bg-blue-500" : "bg-neutral-200 dark:bg-neutral-700/60",
      )}
      disabled={!props.enabled}
      onPress={props.onPress}
    >
      <Text
        className={cn(
          "font-t3-extrabold text-sm",
          props.enabled ? "text-white" : "text-neutral-500 dark:text-neutral-400",
        )}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}
