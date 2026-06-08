import { z } from "zod";

export const engineeringContextInputSchema = {
  projectName: z.string().optional(),
  projectId: z.string().optional(),
  repoName: z.string().optional(),
  packageName: z.string().optional(),
  gitRemote: z.string().optional(),
  packageManager: z.string().optional(),
  frameworks: z.array(z.string()).optional(),
  lockfiles: z.array(z.string()).optional(),
  rootMarkers: z.array(z.string()).optional(),
  artifactId: z.string().uuid().optional(),
  includeCandidate: z.boolean().optional(),
  includeSuperseded: z.boolean().optional(),
  includeTemporary: z.boolean().optional(),
  preset: z.enum(["codex", "claude_code", "cursor", "generic_mcp"]).optional(),
  maxItemsPerSection: z.number().int().positive().max(100).optional(),
  limit: z.number().int().positive().max(1000).optional(),
} as const;
