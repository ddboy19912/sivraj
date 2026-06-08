import type { ChatMessagePreview } from '@/lib/ai-chat/message-preview'

export function compareChatMessagesByTimestamp(
  left: ChatMessagePreview,
  right: ChatMessagePreview,
) {
  const leftTime = Date.parse(left.timestamp ?? '')
  const rightTime = Date.parse(right.timestamp ?? '')

  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
    return 0
  }

  return leftTime - rightTime
}
