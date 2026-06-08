import { ProviderConfigForm, type ProviderConfigFormProps } from "@/components/chat/ProviderConfigForm";
import type { Session } from "@/lib/session";

export function ProviderConfigDialogBody({
  session,
  formProps,
}: {
  session: Session | null;
  formProps: ProviderConfigFormProps;
}) {
  if (!session) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/64">
        Connect and sign in before linking a model.
      </div>
    );
  }

  return <ProviderConfigForm {...formProps} />;
}
