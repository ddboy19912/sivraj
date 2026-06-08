import type { ArtifactReceipt } from "@/types/console.types";

export function IngestReceiptPanel({ receipt }: { receipt: ArtifactReceipt }) {
  return (
    <div className="console-receipt">
      <h3>Receipt</h3>
      <dl>
        <dt>Artifact ID</dt>
        <dd>{receipt.artifactId}</dd>
        <dt>Storage mode</dt>
        <dd>{receipt.storageMode}</dd>
        <dt>Raw storage ref</dt>
        <dd>{receipt.rawStorageRef ?? "—"}</dd>
        <dt>Processing job ID</dt>
        <dd>{receipt.processingJobId ?? "—"}</dd>
        <dt>Status</dt>
        <dd>{receipt.status}</dd>
        <dt>Import result</dt>
        <dd>
          {receipt.skipped ? `Skipped: ${receipt.reason ?? "duplicate"}` : "Imported"}
        </dd>
        <dt>Warning</dt>
        <dd>{receipt.warning ?? "—"}</dd>
      </dl>
    </div>
  );
}
