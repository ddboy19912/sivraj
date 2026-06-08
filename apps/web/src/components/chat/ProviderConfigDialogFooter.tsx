import { PlugZap, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Session } from "@/lib/session";

type ProviderConfigDialogFooterProps = {
  session: Session | null;
  canSubmit: boolean;
  isBusy: boolean;
  onDisconnect: () => void;
  onTest: () => void;
  onSave: () => void;
};

export function ProviderConfigDialogFooter({
  session,
  canSubmit,
  isBusy,
  onDisconnect,
  onTest,
  onSave,
}: ProviderConfigDialogFooterProps) {
  return (
    <>
      <Button
        type="button"
        variant="destructive"
        onClick={onDisconnect}
        disabled={!session || isBusy}
      >
        <Trash2 className="size-4" />
        Disconnect
      </Button>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={onTest}
          disabled={!canSubmit || isBusy}
        >
          <PlugZap className="size-4" />
          Test
        </Button>
        <Button type="button" onClick={onSave} disabled={!canSubmit || isBusy}>
          Save
        </Button>
      </div>
    </>
  );
}
