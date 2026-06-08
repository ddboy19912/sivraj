import type { DriveDocumentImportResult } from "./document-imports.js";
import {
  fetchGoogleDriveJson,
  fetchGoogleDriveText,
  fetchMicrosoftGraphBase64,
  fetchMicrosoftGraphJson,
  fetchMicrosoftGraphText,
  microsoftDriveItemPath,
} from "./fetch.js";
import { readConnectorMetadataString } from "./metadata-reader.js";
import type { ConnectorArtifactSourceType, ConnectorSource } from "../types/connector.types.js";

type GoogleDriveFile = {
  id?: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  webViewLink?: string;
};

type GoogleDriveListResponse = {
  files?: GoogleDriveFile[];
};

type MicrosoftDriveItem = {
  id?: string;
  name?: string;
  webUrl?: string;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
};

type MicrosoftDriveChildrenResponse = {
  value?: MicrosoftDriveItem[];
};

const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
const WORD_DOC_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function downloadGoogleDriveFile(input: {
  token: string;
  fetcher: typeof fetch;
  file: GoogleDriveFile;
}): Promise<{ sourceType: ConnectorArtifactSourceType; content: string } | null> {
  if (!input.file.id || !input.file.mimeType) {
    return null;
  }

  if (input.file.mimeType === GOOGLE_DOC_MIME) {
    return {
      sourceType: "api",
      content: await fetchGoogleDriveText(
        input.fetcher,
        input.token,
        `/files/${encodeURIComponent(input.file.id)}/export?${new URLSearchParams({
          mimeType: "text/plain",
        }).toString()}`,
      ),
    };
  }

  if (input.file.mimeType === "text/csv") {
    return downloadGoogleDriveMedia(input, "csv");
  }

  if (input.file.mimeType.startsWith("text/")) {
    return downloadGoogleDriveMedia(
      input,
      input.file.mimeType === "text/markdown" ? "markdown" : "upload",
    );
  }

  return null;
}

async function downloadGoogleDriveMedia(
  input: { token: string; fetcher: typeof fetch; file: GoogleDriveFile },
  sourceType: ConnectorArtifactSourceType,
) {
  return {
    sourceType,
    content: await fetchGoogleDriveText(
      input.fetcher,
      input.token,
      `/files/${encodeURIComponent(input.file.id!)}/?alt=media`,
    ),
  };
}

export async function importGoogleDriveSource(input: {
  token: string;
  source: ConnectorSource;
  fetcher: typeof fetch;
}): Promise<DriveDocumentImportResult[]> {
  const sourceId = input.source.externalSourceId || "root";
  const metadataKind = readConnectorMetadataString(input.source.metadata, "kind");
  const files = metadataKind === "file"
    ? [await fetchGoogleDriveJson<GoogleDriveFile>(
        input.fetcher,
        input.token,
        `/files/${encodeURIComponent(sourceId)}?${new URLSearchParams({
          fields: "id,name,mimeType,modifiedTime,webViewLink",
        }).toString()}`,
      )]
    : (await fetchGoogleDriveJson<GoogleDriveListResponse>(
        input.fetcher,
        input.token,
        `/files?${new URLSearchParams({
          pageSize: "10",
          q: `'${sourceId}' in parents and trashed=false`,
          fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
        }).toString()}`,
      )).files ?? [];

  return collectDriveImports(input, files, "google_drive", "google_drive_file");
}

async function downloadMicrosoftDriveItem(input: {
  token: string;
  fetcher: typeof fetch;
  item: MicrosoftDriveItem;
}): Promise<{ sourceType: ConnectorArtifactSourceType; content: string } | null> {
  const mimeType = input.item.file?.mimeType ?? "";

  if (!input.item.id) {
    return null;
  }

  const contentPath = `${microsoftDriveItemPath(input.item.id)}/content`;

  if (mimeType === "text/csv") {
    return {
      sourceType: "csv",
      content: await fetchMicrosoftGraphText(input.fetcher, input.token, contentPath),
    };
  }

  if (mimeType.startsWith("text/")) {
    return {
      sourceType: mimeType === "text/markdown" ? "markdown" : "upload",
      content: await fetchMicrosoftGraphText(input.fetcher, input.token, contentPath),
    };
  }

  if (mimeType === WORD_DOC_MIME) {
    return {
      sourceType: "docx",
      content: await fetchMicrosoftGraphBase64(input.fetcher, input.token, contentPath),
    };
  }

  return null;
}

export async function importMicrosoftOneDriveSource(input: {
  token: string;
  source: ConnectorSource;
  fetcher: typeof fetch;
}): Promise<DriveDocumentImportResult[]> {
  const itemId = input.source.externalSourceId || "root";
  const item = await fetchMicrosoftGraphJson<MicrosoftDriveItem>(
    input.fetcher,
    input.token,
    microsoftDriveItemPath(itemId),
  );
  const items = item.folder
    ? (await fetchMicrosoftGraphJson<MicrosoftDriveChildrenResponse>(
        input.fetcher,
        input.token,
        `${microsoftDriveItemPath(itemId)}/children?$top=10`,
      )).value ?? []
    : [item];

  const imported: DriveDocumentImportResult[] = [];

  for (const child of items) {
    if (!child.id || child.folder) {
      continue;
    }

    const downloaded = await downloadMicrosoftDriveItem({
      token: input.token,
      fetcher: input.fetcher,
      item: child,
    });

    if (!downloaded) {
      continue;
    }

    imported.push({
      provider: "microsoft_onedrive",
      sourceType: downloaded.sourceType,
      externalItemId: child.id,
      title: child.name ?? child.id,
      content: downloaded.content,
      uri: child.webUrl ?? null,
      metadata: {
        importer: "microsoft_onedrive_item",
        fileId: child.id,
        fileName: child.name ?? child.id,
        mimeType: child.file?.mimeType ?? null,
        modifiedTime: child.lastModifiedDateTime ?? null,
      },
    });
  }

  return imported;
}

async function collectDriveImports(
  input: { token: string; fetcher: typeof fetch },
  files: GoogleDriveFile[],
  provider: "google_drive",
  importer: "google_drive_file",
): Promise<DriveDocumentImportResult[]> {
  const imported: DriveDocumentImportResult[] = [];

  for (const file of files) {
    if (!file.id || !file.name || file.mimeType === "application/vnd.google-apps.folder") {
      continue;
    }

    const exported = await downloadGoogleDriveFile({
      token: input.token,
      fetcher: input.fetcher,
      file,
    });

    if (!exported) {
      continue;
    }

    imported.push({
      provider,
      sourceType: exported.sourceType,
      externalItemId: file.id,
      title: file.name,
      content: exported.content,
      uri: file.webViewLink ?? null,
      metadata: {
        importer,
        fileId: file.id,
        fileName: file.name,
        mimeType: file.mimeType ?? null,
        modifiedTime: file.modifiedTime ?? null,
      },
    });
  }

  return imported;
}
