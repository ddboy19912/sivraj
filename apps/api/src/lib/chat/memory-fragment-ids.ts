import type { ChatMemoryContext } from "../../types/chat.types.js";
import { isUuid } from "./attachments.js";

export function memoryFragmentIdsFromMemoryContext(
  memoryContext: ChatMemoryContext,
  documentContext?: {
    passages?: Array<{ memoryFragmentId?: string }>;
  } | null,
): string[] {
  const ids = [
    ...memoryContext.results.map((result) => result.memory.id),
    ...(documentContext?.passages?.map((passage) => passage.memoryFragmentId).filter(Boolean) as string[] ?? []),
  ];
  return Array.from(new Set(ids)).filter(isUuid);
}
