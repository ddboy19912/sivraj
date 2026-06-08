import { notionBlockToText } from "./notion.js";

type NotionBlock = {
  id?: string;
  type?: string;
  has_children?: boolean;
  [key: string]: unknown;
};

type NotionListResponse<T> = {
  results?: T[];
  has_more?: boolean;
  next_cursor?: string | null;
};

export function shouldStopNotionBlockTraversal(depth: number, maxDepth = 4) {
  return depth > maxDepth;
}

export async function readNotionBlocks(input: {
  fetcher: typeof fetch;
  token: string;
  blockId: string;
  lines: string[];
  depth: number;
  startCursor?: string;
  onBlock(): boolean;
  fetchNotionJson<T>(fetcher: typeof fetch, token: string, path: string): Promise<T>;
}): Promise<void> {
  if (shouldStopNotionBlockTraversal(input.depth)) {
    return;
  }

  const params = new URLSearchParams({ page_size: "100" });

  if (input.startCursor) {
    params.set("start_cursor", input.startCursor);
  }

  const list = await input.fetchNotionJson<NotionListResponse<NotionBlock>>(
    input.fetcher,
    input.token,
    `/blocks/${input.blockId}/children?${params.toString()}`,
  );

  for (const block of list.results ?? []) {
    if (!input.onBlock()) {
      return;
    }

    const line = notionBlockToText(block, input.depth);

    if (line) {
      input.lines.push(line);
    }

    if (block.has_children && block.id) {
      await readNotionBlocks({
        ...input,
        blockId: block.id,
        depth: input.depth + 1,
      });
    }
  }

  if (list.has_more && list.next_cursor) {
    await readNotionBlocks({
      ...input,
      startCursor: list.next_cursor,
    });
  }
}
