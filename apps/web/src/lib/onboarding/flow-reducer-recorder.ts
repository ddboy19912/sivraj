import type {
  OnboardingAction,
  OnboardingState,
} from '@/types/onboarding.types'

export function handleRecorderActions(
  state: OnboardingState,
  action: OnboardingAction,
): OnboardingState | null {
  switch (action.type) {
    case 'RECORDER_STATE':
      return { ...state, recorderState: action.value }
    case 'RECORDING_TICK':
      return { ...state, recordingSeconds: action.seconds }
    case 'RECORDING_READY':
      return {
        ...state,
        recordedBlob: action.blob,
        recordingPreviewUrl: action.previewUrl,
        recorderState: 'recorded',
      }
    case 'RECORDING_CLEARED':
      return {
        ...state,
        recorderState: 'idle',
        recordingSeconds: 0,
        recordedBlob: null,
        recordingPreviewUrl: null,
      }
    default:
      return null
  }
}
