export type TimelineStepVisualState = {
  isActive: boolean;
  isComplete: boolean;
  isUnlocked: boolean;
};

export function getOnboardingTimelineProgress(activeIndex: number, stepCount: number) {
  return activeIndex === 0 ? 0 : (activeIndex / (stepCount - 1)) * 100;
}

export function getTimelineStepVisualState(input: {
  index: number;
  activeIndex: number;
  currentStepId: string | null;
  stepId: string;
  unlockedStepIndex: number;
}): TimelineStepVisualState {
  return {
    isActive: input.currentStepId === input.stepId,
    isComplete: input.index < input.activeIndex,
    isUnlocked: input.index <= input.unlockedStepIndex,
  };
}
