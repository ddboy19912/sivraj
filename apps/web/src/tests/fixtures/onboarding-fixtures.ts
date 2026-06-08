import { vi } from 'vitest'
import type { OnboardingFlow } from '@/types/onboarding.types'
import type { TwinBootstrap } from '@/types/wallet.types'

export function createFlow(overrides: Partial<OnboardingFlow>): OnboardingFlow {
  return {
    account: null,
    accessState: {
      status: 'wallet_auth',
      hasWallet: false,
      error: null,
      hasCompletionHint: false,
    },
    session: null,
    setSession: vi.fn(),
    phase: 'no_wallet',
    currentStep: null,
    twinName: '',
    twinNameInput: '',
    displayName: '',
    alias: '',
    firstMemory: '',
    greeting: '',
    greetingAudioUrl: null,
    greetingAudioFailed: false,
    firstMeetIntroStatus: 'not_started',
    firstMeetIntroActive: false,
    runtimeEvents: [],
    voicePresets: [],
    selectedVoiceId: 'warm_operator',
    previewingVoiceId: null,
    recorderState: 'idle',
    recordingSeconds: 0,
    recordedBlob: null,
    recordingPreviewUrl: null,
    cloneConsent: false,
    isBusy: false,
    error: null,
    isSessionForWallet: false,
    canUseProtectedApp: false,
    completedOnboardingHint: false,
    onboardingComplete: false,
    unlockedStepIndex: 0,
    signIn: vi.fn(),
    resetSession: vi.fn(),
    beginOnboarding: vi.fn(),
    goToStep: vi.fn(),
    saveTwinName: vi.fn(),
    chooseTextArrival: vi.fn(),
    chooseVoiceArrival: vi.fn(),
    previewPresetVoice: vi.fn(),
    chooseClonedVoiceArrival: vi.fn(),
    startVoiceCloneRecording: vi.fn(),
    stopVoiceCloneRecording: vi.fn(),
    clearVoiceCloneRecording: vi.fn(),
    saveIdentitySeed: vi.fn(),
    setTwinNameInput: vi.fn(),
    setSelectedVoiceId: vi.fn(),
    setCloneConsent: vi.fn(),
    setDisplayName: vi.fn(),
    setAlias: vi.fn(),
    setFirstMemory: vi.fn(),
    ...overrides,
  } as OnboardingFlow
}

export function walletAccount(address: string): OnboardingFlow['account'] {
  return { address } as OnboardingFlow['account']
}

export function createBootstrap(
  onboardingStatus: 'not_started' | 'in_progress' | 'completed',
): TwinBootstrap {
  return {
    profile: {
      twinId: 'twin',
      name: onboardingStatus === 'completed' ? 'Jarvis' : 'Primary Twin',
    },
    identity: {
      twinId: 'twin',
      displayName: null,
      aliases: [],
      emails: [],
      phones: [],
      handles: {},
      selfDescriptionArtifactId: null,
      onboardingStatus,
      firstMeetIntroStatus: onboardingStatus === 'completed' ? 'consumed' : 'not_started',
      shouldPlayFirstMeetIntro: false,
      events: [],
    },
    voiceResponse: null,
  }
}
