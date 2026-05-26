export type BehaviorPatternMetadata = {
  patternKey: string;
  patternTags: string[];
};

type BehaviorPatternDefinition = {
  subject: string;
  tags: string[];
  matches(text: string): boolean;
};

const BEHAVIOR_PATTERNS: Record<string, BehaviorPatternDefinition> = {
  launch_delay_ui_polish: {
    subject: "Launch delay from UI polish",
    tags: ["launch", "delay", "ui_polish"],
    matches(text) {
      const launch = /\b(launch|launching|launched|ship|shipping|release|released)\b/.test(text);
      const delay = /\b(delay|delayed|delaying|slip|slipping|postpone|postponed|blocked|slow)\b/.test(text);
      const polish = /\b(polish|polishing|redesign|redesigning|dashboard|ui|interface|perfect|perfection)\b/.test(text);

      return launch && delay && polish;
    },
  },
  walrus_seal_rpc_fetch_failure: {
    subject: "Walrus/Seal RPC fetch failure",
    tags: ["walrus", "seal", "rpc", "fetch_failure"],
    matches(text) {
      const privateStorage = /\b(walrus|seal|private memory|encrypted memory|blob)\b/.test(text);
      const rpcFetch = /\b(rpc|fetch failed|network|key server|decrypt|decryption|walrus_read|seal_decrypt)\b/.test(text);
      const failure = /\b(fail|fails|failed|failing|failure|error|exception|retry|timeout)\b/.test(text);

      return privateStorage && rpcFetch && failure;
    },
  },
  missing_environment_configuration: {
    subject: "Missing environment configuration",
    tags: ["env", "configuration", "missing"],
    matches(text) {
      const env = /\b(env|environment|config|configuration|secret|api key|database_url|redis_url|jwt_secret)\b/.test(text);
      const missing = /\b(missing|required|not configured|undefined|empty|invalid)\b/.test(text);

      return env && missing;
    },
  },
  wallet_or_provider_hook_mocking_failure: {
    subject: "Wallet/provider hook mocking failure",
    tags: ["testing", "wallet", "mocking"],
    matches(text) {
      const test = /\b(test|vitest|mock|mocked|mocking|testing library)\b/.test(text);
      const walletProvider = /\b(wallet|dapp kit|provider|hook|usecurrentaccount|signpersonalmessage)\b/.test(text);
      const failure = /\b(fail|fails|failed|failing|error|exception)\b/.test(text);

      return test && walletProvider && failure;
    },
  },
};

export function inferBehaviorPatternMetadata(input: {
  statement: string;
  normalizedStatement?: string | null;
  subject?: string | null;
  metadata?: Record<string, unknown>;
}): BehaviorPatternMetadata | null {
  const text = [
    input.statement,
    input.normalizedStatement ?? "",
    input.subject ?? "",
    ...Object.values(input.metadata ?? {}).filter((value): value is string => typeof value === "string"),
  ].join(" ").toLowerCase();

  for (const [patternKey, definition] of Object.entries(BEHAVIOR_PATTERNS)) {
    if (definition.matches(text)) {
      return {
        patternKey,
        patternTags: definition.tags,
      };
    }
  }

  return null;
}

export function behaviorPatternSubject(patternKey: string): string {
  return BEHAVIOR_PATTERNS[patternKey]?.subject ?? patternKey.replace(/_/g, " ");
}
