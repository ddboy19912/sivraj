import { ConsoleTable } from "@/console/console-page-ui";
import type { AgentWritebackRow } from "@/types/console.types";

type AgentWritebacksTableProps = {
  rows: AgentWritebackRow[];
  isSubmitting: boolean;
  onApprove: (writebackId: string) => void;
  onReject: (writebackId: string) => void;
};

export function AgentWritebacksTable({
  rows,
  isSubmitting,
  onApprove,
  onReject,
}: AgentWritebacksTableProps) {
  return (
    <ConsoleTable
      headers={[
        "ID",
        "Agent",
        "Status",
        "Repo",
        "Counts",
        "Storage",
        "Approved artifact",
        "Actions",
      ]}
    >
      {rows.map((row) => (
        <tr key={row.id}>
          <td>{row.id.slice(0, 8)}…</td>
          <td>{row.agentName}</td>
          <td>{row.status}</td>
          <td>
            {row.repo ?? "—"} {row.branch ? `· ${row.branch}` : ""}
          </td>
          <td>
            files {row.counts.filesTouched} · commands {row.counts.commandsRun} · tests{" "}
            {row.counts.testsRun} · decisions {row.counts.decisions}
          </td>
          <td>{row.rawStorageRef ? `${row.rawStorageRef.slice(0, 22)}…` : "—"}</td>
          <td>
            {row.approvedArtifactId ? `${row.approvedArtifactId.slice(0, 8)}…` : "—"}
          </td>
          <td className="console-row-actions">
            <button
              className="secondary-action compact"
              type="button"
              disabled={isSubmitting || row.status !== "pending"}
              onClick={() => onApprove(row.id)}
            >
              Approve
            </button>
            <button
              className="secondary-action compact"
              type="button"
              disabled={isSubmitting || row.status !== "pending"}
              onClick={() => onReject(row.id)}
            >
              Reject
            </button>
          </td>
        </tr>
      ))}
    </ConsoleTable>
  );
}
