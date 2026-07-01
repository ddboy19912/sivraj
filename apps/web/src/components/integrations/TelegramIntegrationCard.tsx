import {
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  Send,
  Unplug,
} from "lucide-react";
import { useEffect, useReducer, useRef } from "react";
import { FaTelegram } from "react-icons/fa";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ClipboardActionButton } from "@/components/ui/clipboard-action-button";
import { errorMessage } from "@/lib/api";
import type { Session } from "@/lib/session";
import {
  createTelegramLinkToken,
  loadTelegramConnection,
  revokeTelegramConnection,
} from "@/lib/telegram/telegram-api";
import {
  resolveTelegramConnectionSubtitle,
  resolveTelegramStatusPresentation,
  telegramStatusDotClass,
} from "@/lib/telegram/telegram-state";
import {
  initialTelegramIntegrationState,
  telegramIntegrationReducer,
  type TelegramIntegrationStatus,
} from "@/lib/telegram/telegram-integration-state";
import { cn } from "@/lib/ui/utils";
import type {
  TelegramConnectionResponse,
  TelegramLinkTokenResponse,
} from "@/types/telegram.types";

type TelegramIntegrationCardProps = {
  session: Session;
  onSessionRefreshed: (session: Session) => void;
};

export function TelegramIntegrationCard({
  session,
  onSessionRefreshed,
}: TelegramIntegrationCardProps) {
  const [viewState, dispatchView] = useReducer(
    telegramIntegrationReducer,
    initialTelegramIntegrationState,
  );
  const sessionRef = useRef(session);
  const onSessionRefreshedRef = useRef(onSessionRefreshed);
  const { connection, latestLink, loadedTwinId, notice, status } = viewState;
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
  }, [onSessionRefreshed, session, session.twinId]);

  async function refreshConnection() {
    const activeSession = sessionRef.current;

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

  return (
    <article className="max-w-3xl rounded-[6px] border border-white/10 bg-[#05080c]/72 px-4 py-4 sm:px-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="flex min-w-0 gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-[6px] border border-[#35a9e4]/18 bg-[#229ed9]/12 text-[#35a9e4]">
            <FaTelegram className="size-6" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold tracking-tight text-white">
                Telegram
              </h2>
              <StatusBadge presentation={presentation} />
            </div>
            <p className="mt-1 max-w-xl text-sm leading-6 text-white/54">
              {resolveTelegramConnectionSubtitle(connection, presentation)}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <TelegramIntegrationActions
            connection={connection}
            isBusy={isBusy}
            linkTarget={linkTarget}
            status={status}
            onCreateLink={() => void createLink({ openTelegram: true })}
            onOpenLatestLink={() =>
              latestLink ? openTelegramLink(latestLink, null) : undefined
            }
            onRefresh={() => void refreshConnection()}
            onRevoke={() => void revoke()}
          />
        </div>
      </div>

      {latestLink ? <TelegramPairingLink link={latestLink} /> : null}

      {notice ? (
        <p className="mt-4 rounded-xl border border-rose-300/20 bg-rose-300/8 px-3 py-2 text-sm text-rose-100/82">
          {notice}
        </p>
      ) : null}

      {loadedTwinId ? (
        <p className="sr-only">Telegram integration loaded for {loadedTwinId}.</p>
      ) : null}
    </article>
  );
}

function StatusBadge({
  presentation,
}: {
  presentation: ReturnType<typeof resolveTelegramStatusPresentation>;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-2 py-1 text-[0.7rem] font-semibold text-white/70">
      <span
        className={cn(
          "size-1.5 rounded-full",
          telegramStatusDotClass(presentation.tone),
        )}
      />
      {presentation.label}
    </span>
  );
}

function TelegramIntegrationActions({
  connection,
  isBusy,
  linkTarget,
  status,
  onCreateLink,
  onOpenLatestLink,
  onRefresh,
  onRevoke,
}: {
  connection: TelegramConnectionResponse | null;
  isBusy: boolean;
  linkTarget: string | null;
  status: TelegramIntegrationStatus;
  onCreateLink: () => void;
  onOpenLatestLink: () => void;
  onRefresh: () => void;
  onRevoke: () => void;
}) {
  const connectionStatus = connection?.status ?? "unlinked";
  const canDisconnect = connectionStatus === "linked";
  const canConnect = connectionStatus !== "linked";
  const canCheckStatus = connectionStatus === "pending_link" || status === "failed";
  const isPending = connectionStatus === "pending_link";

  return (
    <>
      {isPending ? (
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={isBusy || !linkTarget}
          onClick={onOpenLatestLink}
          className="h-9 rounded-[4px] border-[rgba(var(--theme-color-rgb),0.36)] bg-[rgba(var(--theme-color-rgb),0.14)] px-3 text-[rgb(var(--theme-color-rgb))] hover:border-[rgba(var(--theme-color-rgb),0.58)] hover:bg-[rgba(var(--theme-color-rgb),0.2)]"
        >
          {status === "creating_link" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <ExternalLink className="size-3.5" />
          )}
          Open Telegram
        </Button>
      ) : canConnect ? (
        <Button
          type="button"
          size="sm"
          variant="default"
          disabled={isBusy}
          onClick={onCreateLink}
          className="h-9 rounded-[4px] border-[rgba(var(--theme-color-rgb),0.36)] bg-[rgba(var(--theme-color-rgb),0.14)] px-3 text-[rgb(var(--theme-color-rgb))] hover:border-[rgba(var(--theme-color-rgb),0.58)] hover:bg-[rgba(var(--theme-color-rgb),0.2)]"
        >
          {status === "creating_link" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Send className="size-3.5" />
          )}
          Connect
        </Button>
      ) : null}
      {canCheckStatus ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isBusy}
          onClick={onRefresh}
          className="h-9 rounded-[4px] border-white/10 bg-white/[0.035] px-3 text-white/58 hover:bg-white/[0.07] hover:text-white/82"
        >
          <RefreshCw
            className={cn("size-3.5", status === "loading" && "animate-spin")}
          />
          Check status
        </Button>
      ) : null}
      {isPending ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isBusy}
          onClick={onCreateLink}
          className="h-9 rounded-[4px] border-white/10 bg-white/[0.035] px-3 text-white/58 hover:bg-white/[0.07] hover:text-white/82"
        >
          <RefreshCw className="size-3.5" />
          New link
        </Button>
      ) : null}
      {canDisconnect ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={isBusy}
          onClick={onRevoke}
          className="h-9 rounded-[4px] border-rose-200/18 bg-rose-300/6 px-3 text-rose-100/70 hover:border-rose-200/30 hover:bg-rose-300/10 hover:text-rose-100"
        >
          {status === "revoking" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <Unplug className="size-3.5" />
          )}
          Revoke
        </Button>
      ) : null}
    </>
  );
}

function TelegramPairingLink({ link }: { link: TelegramLinkTokenResponse }) {
  return (
    <div className="mt-4 rounded-[6px] border border-white/10 bg-black/16 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white/78">
            Waiting for Telegram
          </p>
          <p className="mt-1 text-xs text-white/42">
            Use the start command before the link expires.
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
