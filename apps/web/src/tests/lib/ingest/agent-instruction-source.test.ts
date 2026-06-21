import { describe, expect, it } from "vitest";
import {
  agentInstructionMetadataForFile,
  buildAgentInstructionMetadata,
  inferAgentInstructionTargetFile,
  isAgentInstructionFileName,
  isMarkdownSourceFileName,
  normalizeSourceFileName,
} from "@/lib/ingest/agent-instruction-source";

describe("agent instruction source helpers", () => {
  it("detects common agent instruction file names and paths", () => {
    expect(isAgentInstructionFileName("AGENTS.md")).toBe(true);
    expect(isAgentInstructionFileName("CLAUDE.md")).toBe(true);
    expect(isAgentInstructionFileName(".cursor/rules/sivraj.mdc")).toBe(true);
    expect(isAgentInstructionFileName(".github/copilot-instructions.md")).toBe(true);
    expect(isAgentInstructionFileName("README.md")).toBe(false);
  });

  it("infers normalized target instruction files", () => {
    expect(inferAgentInstructionTargetFile("docs/CLAUDE.md")).toBe("CLAUDE.md");
    expect(inferAgentInstructionTargetFile(".cursor/rules/team.mdc"))
      .toBe(".cursor/rules/sivraj.mdc");
    expect(inferAgentInstructionTargetFile("AGENT.md")).toBe("AGENTS.md");
    expect(inferAgentInstructionTargetFile("notes.txt")).toBeNull();
  });

  it("builds safe metadata for exact source artifacts", () => {
    expect(buildAgentInstructionMetadata({
      targetFile: "AGENTS.md",
      origin: "draft",
      fileName: "../AGENTS.md",
      uploadSurface: "chat",
    })).toMatchObject({
      artifactPurpose: "agent_skill_source",
      engineeringSourceKind: "agent_instruction_file",
      targetInstructionFile: "AGENTS.md",
      agentInstructionOrigin: "draft",
      uploadSurface: "chat",
      agentInstructionFileName: "AGENTS.md",
    });
  });

  it("adds agent instruction metadata for uploaded files", () => {
    const file = new File(["# Instructions"], "CLAUDE.md", {
      type: "text/markdown",
    });

    expect(agentInstructionMetadataForFile(file)).toMatchObject({
      artifactPurpose: "agent_skill_source",
      engineeringSourceKind: "agent_instruction_file",
      targetInstructionFile: "CLAUDE.md",
      agentInstructionOrigin: "upload",
      agentInstructionFileName: "CLAUDE.md",
    });
  });

  it("normalizes custom source filenames without forcing agent skill metadata", () => {
    expect(normalizeSourceFileName("README")).toBe("README.md");
    expect(normalizeSourceFileName("notes.markdown")).toBe("notes.markdown");
    expect(normalizeSourceFileName("src/demo.ts")).toBe("demo.ts");
    expect(isMarkdownSourceFileName("README.md")).toBe(true);
    expect(isMarkdownSourceFileName("docs.mdx")).toBe(true);
    expect(isMarkdownSourceFileName("demo.ts")).toBe(false);
    expect(isAgentInstructionFileName("README.md")).toBe(false);
  });
});
