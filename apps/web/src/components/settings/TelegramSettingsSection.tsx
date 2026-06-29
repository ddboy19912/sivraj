import { ExternalLink, LoaderCircle, RefreshCw, Send, Unplug } from "lucide-react";
import { useEffect, useReducer, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClipboardActionButton } from "@/components/ui/clipboard-action-button";
import {
  createTelegramLinkToken,
  loadTelegramConnection,
  revokeTelegramConnection,
} from "@/lib/telegram/telegram-api";
import {
  formatTelegramDate,
  resolveTelegramConnectionSubtitle,
  resolveTelegramStatusPresentation,
  telegramStatusDotClass,
} from "@/lib/telegram/telegram-state";
import { errorMessage } from "@/lib/api";
import type { Session } from "@/lib/session";
import { cn } from "@/lib/ui/utils";
import type {
  TelegramConnectionResponse,
  TelegramLinkTokenResponse,
} from "@/types/telegram.types";

type TelegramSettingsSectionProps = {
  session: Session | null;
  onSessionRefreshed: (session: Session) => void;
};

type TelegramSettingsViewStatus =
  | "idle"
  | "loading"
  | "creating_link"
  | "revoking"
  | "failed";

type TelegramSettingsViewState = {
  connection: TelegramConnectionResponse | null;
  latestLink: TelegramLinkTokenResponse | null;
  loadedTwinId: string | null;
  status: TelegramSettingsViewStatus;
  notice: string | null;
};

type TelegramSettingsViewAction =
  | { type: "LOAD_STARTED"; twinId: string }
  | { type: "LOAD_SUCCEEDED"; twinId: string; connection: TelegramConnectionResponse }
  | { type: "LOAD_FAILED"; error: string }
  | { type: "CREATING_LINK" }
  | { type: "LINK_CREATED"; link: TelegramLinkTokenResponse }
  | { type: "REVOKING" }
  | { type: "REVOKED" }
  | { type: "ACTION_FAILED"; error: string };

const initialTelegramSettingsViewState: TelegramSettingsViewState = {
  connection: null,
  latestLink: null,
  loadedTwinId: null,
  status: "idle",
  notice: null,
};

function telegramSettingsViewReducer(
  state: TelegramSettingsViewState,
  action: TelegramSettingsViewAction,
): TelegramSettingsViewState {
  switch (action.type) {
    case "LOAD_STARTED":
      return {
        ...state,
        loadedTwinId: action.twinId,
        status: "loading",
        notice: null,
      };
    case "LOAD_SUCCEEDED":
      return {
        ...state,
        connection: action.connection,
        loadedTwinId: action.twinId,
        status: "idle",
        notice: null,
      };
    case "LOAD_FAILED":
      return { ...state, status: "failed", notice: action.error };
    case "CREATING_LINK":
      return { ...state, status: "creating_link", notice: null };
    case "LINK_CREATED":
      return {
        ...state,
        latestLink: action.link,
        connection: state.connection
          ? {
              ...state.connection,
              status: action.link.status,
              botUsername: action.link.botUsername,
              pendingLink: {
                id: action.link.tokenId,
                expiresAt: action.link.expiresAt,
              },
            }
          : state.connection,
        status: "idle",
      };
    case "REVOKING":
      return { ...state, status: "revoking", notice: null };
    case "REVOKED":
      return {
        ...state,
        latestLink: null,
        connection: state.connection
          ? {
              ...state.connection,
              status: "revoked",
              pendingLink: null,
              account: state.connection.account
                ? { ...state.connection.account, status: "disconnected" }
                : null,
            }
          : state.connection,
        status: "idle",
      };
    case "ACTION_FAILED":
      return { ...state, status: "failed", notice: action.error };
  }
}

export function TelegramSettingsSection({
  session,
  onSessionRefreshed,
}: TelegramSettingsSectionProps) {
  const [viewState, dispatchView] = useReducer(
    telegramSettingsViewReducer,
    initialTelegramSettingsViewState,
  );
  const sessionRef = useRef(session);
  const onSessionRefreshedRef = useRef(onSessionRefreshed);
  const { connection, latestLink, loadedTwinId, status, notice } = viewState;
  const presentation = resolveTelegramStatusPresentation(
    connection?.status ?? "unlinked",
  );
  const isBusy =
    status === "loading" ||
    status === "creating_link" ||
    status === "revoking";
  const linkTarget = latestLink?.deepLink ?? null;

  useEffect(() => {
    sessionRef.current = session;
    onSessionRefreshedRef.current = onSessionRefreshed;
  }, [onSessionRefreshed, session]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;
    dispatchView({ type: "LOAD_STARTED", twinId: session.twinId });

    void loadTelegramConnection(session, onSessionRefreshed)
      .then((nextConnection) => {
        if (!cancelled) {
          dispatchView({
            type: "LOAD_SUCCEEDED",
            twinId: session.twinId,
            connection: nextConnection,
          });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          dispatchView({ type: "LOAD_FAILED", error: errorMessage(error) });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [onSessionRefreshed, session, session?.twinId]);

  async function refreshConnection() {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      return;
    }

    dispatchView({ type: "LOAD_STARTED", twinId: activeSession.twinId });
    try {
      const nextConnection = await loadTelegramConnection(
        activeSession,
        onSessionRefreshedRef.current,
      );
      dispatchView({
        type: "LOAD_SUCCEEDED",
        twinId: activeSession.twinId,
        connection: nextConnection,
      });
    } catch (error) {
      dispatchView({ type: "LOAD_FAILED", error: errorMessage(error) });
    }
  }

  async function createLink(options: { openTelegram?: boolean } = {}) {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      return;
    }

    const telegramWindow = options.openTelegram
      ? openPendingTelegramWindow()
      : null;

    dispatchView({ type: "CREATING_LINK" });
    try {
      const link = await createTelegramLinkToken(
        activeSession,
        onSessionRefreshedRef.current,
      );
      dispatchView({ type: "LINK_CREATED", link });
      if (options.openTelegram) {
        openTelegramLink(link, telegramWindow);
      }
      toast.success(options.openTelegram ? "Opening Telegram" : "Telegram link created");
    } catch (error) {
      telegramWindow?.close();
      const message = errorMessage(error);
      dispatchView({ type: "ACTION_FAILED", error: message });
      toast.error("Telegram link failed", { description: message });
    }
  }

  async function revoke() {
    const activeSession = sessionRef.current;

    if (!activeSession) {
      return;
    }

    dispatchView({ type: "REVOKING" });
    try {
      await revokeTelegramConnection(activeSession, onSessionRefreshedRef.current);
      dispatchView({ type: "REVOKED" });
      toast.success("Telegram revoked");
    } catch (error) {
      const message = errorMessage(error);
      dispatchView({ type: "ACTION_FAILED", error: message });
      toast.error("Telegram revoke failed", { description: message });
    }
  }

  if (!session) {
    return (
      <section>
        <SectionLabel>Integrations</SectionLabel>
        <div className="rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-3 text-sm text-white/54">
          Connect a wallet to manage Telegram.
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <TelegramIntegrationCard
        connection={connection}
        isBusy={isBusy}
        latestLink={latestLink}
        linkTarget={linkTarget}
        notice={notice}
        presentation={presentation}
        status={status}
        onCreateLink={() => void createLink({ openTelegram: true })}
        onOpenLatestLink={() => latestLink ? openTelegramLink(latestLink, null) : undefined}
        onRefresh={() => void refreshConnection()}
        onRevoke={() => void revoke()}
      />

      <TelegramRecentCaptures captures={connection?.recentCaptures ?? []} />

      {loadedTwinId ? (
        <p className="sr-only">Telegram settings loaded for {loadedTwinId}.</p>
      ) : null}
    </section>
  );
}

type TelegramIntegrationCardProps = {
  connection: TelegramConnectionResponse | null;
  isBusy: boolean;
  latestLink: TelegramLinkTokenResponse | null;
  linkTarget: string | null;
  notice: string | null;
  presentation: ReturnType<typeof resolveTelegramStatusPresentation>;
  status: TelegramSettingsViewStatus;
  onCreateLink: () => void;
  onOpenLatestLink: () => void;
  onRefresh: () => void;
  onRevoke: () => void;
};

function TelegramIntegrationCard({
  connection,
  isBusy,
  latestLink,
  linkTarget,
  notice,
  presentation,
  status,
  onCreateLink,
  onOpenLatestLink,
  onRefresh,
  onRevoke,
}: TelegramIntegrationCardProps) {
  return (
    <div>
      <SectionLabel>Integrations</SectionLabel>
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
        <TelegramIntegrationHeader
          connection={connection}
          isBusy={isBusy}
          presentation={presentation}
          status={status}
          onRefresh={onRefresh}
        />
        <TelegramIntegrationActions
          connection={connection}
          isBusy={isBusy}
          linkTarget={linkTarget}
          status={status}
          onCreateLink={onCreateLink}
          onOpenLatestLink={onOpenLatestLink}
          onRevoke={onRevoke}
        />
        {latestLink ? <TelegramPairingLink link={latestLink} /> : null}
        {notice ? (
          <p className="mt-3 rounded-xl border border-rose-300/20 bg-rose-300/8 px-3 py-2 text-sm text-rose-100/82">
            {notice}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function TelegramIntegrationHeader({
  connection,
  isBusy,
  presentation,
  status,
  onRefresh,
}: Pick<
  TelegramIntegrationCardProps,
  "connection" | "isBusy" | "presentation" | "status" | "onRefresh"
>) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Send className="size-4 text-[rgb(var(--theme-color-rgb))]" />
          <h3 className="text-sm font-semibold text-white">Telegram</h3>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2 py-1 text-[0.7rem] font-semibold text-white/74",
              "bg-white/[0.035]",
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                telegramStatusDotClass(presentation.tone),
              )}
            />
            {presentation.label}
          </span>
        </div>
        <p className="mt-1 text-sm text-white/56">
          {resolveTelegramConnectionSubtitle(connection, presentation)}
        </p>
      </div>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Refresh Telegram"
        title="Refresh Telegram"
        disabled={isBusy}
        onClick={onRefresh}
      >
        <RefreshCw className={cn("size-4", status === "loading" && "animate-spin")} />
      </Button>
    </div>
  );
}

function TelegramIntegrationActions({
  connection,
  isBusy,
  linkTarget,
  status,
  onCreateLink,
  onOpenLatestLink,
  onRevoke,
}: Pick<
  TelegramIntegrationCardProps,
  | "connection"
  | "isBusy"
  | "linkTarget"
  | "status"
  | "onCreateLink"
  | "onOpenLatestLink"
  | "onRevoke"
>) {
  const connectionStatus = connection?.status ?? "unlinked";
  const canDisconnect = connectionStatus === "linked";
  const isPending = connectionStatus === "pending_link";

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {isPending ? (
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={isBusy || !linkTarget}
          onClick={onOpenLatestLink}
        >
          {status === "creating_link" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <ExternalLink className="size-3.5" />
          )}
          Open Telegram
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={isBusy}
          onClick={onCreateLink}
        >
          {status === "creating_link" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Connect Telegram
        </Button>
      )}
      {isPending ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isBusy}
          onClick={onCreateLink}
        >
          <RefreshCw className="size-3.5" />
          New link
        </Button>
      ) : null}
      {canDisconnect ? (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={isBusy}
          onClick={onRevoke}
        >
          {status === "revoking" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Unplug className="size-3.5" />
          )}
          Disconnect
        </Button>
      ) : null}
    </div>
  );
}

function TelegramPairingLink({ link }: { link: TelegramLinkTokenResponse }) {
  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-black/16 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white/78">Waiting for Telegram</p>
          <p className="mt-1 text-xs text-white/42">
            Expires {formatTelegramDate(link.expiresAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {link.deepLink ? (
            <Button asChild size="icon-sm" variant="ghost">
              <a
                href={link.deepLink}
                target="_blank"
                rel="noreferrer"
                aria-label="Open Telegram"
                title="Open Telegram"
              >
                <ExternalLink className="size-4" />
              </a>
            </Button>
          ) : null}
          <ClipboardActionButton
            action="copy"
            value={link.startCommand ?? `/start ${link.token}`}
            feedbackLabel="Copied start command"
            aria-label="Copy Telegram start command"
          />
        </div>
      </div>
    </div>
  );
}

function TelegramRecentCaptures({
  captures,
}: {
  captures: TelegramConnectionResponse["recentCaptures"];
}) {
  return (
    <div>
      <SectionLabel>Recent Captures</SectionLabel>
      <div className="divide-y divide-white/10 rounded-2xl border border-white/10 bg-white/[0.03]">
        {captures.length > 0 ? (
          captures.map((capture) => (
            <div
              key={capture.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white/78">
                  Message {capture.messageId}
                </p>
                <p className="text-xs text-white/42">
                  {formatTelegramDate(capture.createdAt)}
                </p>
              </div>
              <span className="rounded-full border border-white/10 px-2 py-1 text-[0.68rem] font-semibold text-white/58">
                {capture.status}
              </span>
            </div>
          ))
        ) : (
          <div className="px-3 py-3 text-sm text-white/46">
            No Telegram captures yet.
          </div>
        )}
      </div>
    </div>
  );
}

function openPendingTelegramWindow() {
  const telegramWindow = window.open("about:blank", "_blank");
  if (telegramWindow) {
    telegramWindow.opener = null;
  }

  return telegramWindow;
}

function openTelegramLink(
  link: TelegramLinkTokenResponse,
  telegramWindow: Window | null,
) {
  if (!link.deepLink) {
    telegramWindow?.close();
    return;
  }

  if (telegramWindow) {
    telegramWindow.location.href = link.deepLink;
    return;
  }

  window.open(link.deepLink, "_blank", "noreferrer");
}

function SectionLabel({ children }: { children: string }) {
  return (
    <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-[rgba(231,252,255,0.48)] uppercase">
      {children}
    </p>
  );
}
