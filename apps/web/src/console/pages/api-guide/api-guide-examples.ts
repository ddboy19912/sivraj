import { API_URL } from '@/lib/api'

export function buildApiGuideExamples(input: {
  twinId: string
  token: string
  artifactId: string
}) {
  const { twinId, token, artifactId } = input

  return [
    {
      title: 'Artifact upload',
      curl: `curl -X POST '${API_URL}/v1/twins/${twinId}/artifacts' \\
  -H 'authorization: Bearer ${token}' \\
  -H 'content-type: application/json' \\
  -d '{"sourceType":"note","encryptedPayload":{...}}'`,
    },
    {
      title: 'Memory search',
      curl: `curl -X POST '${API_URL}/v1/twins/${twinId}/memories/search' \\
  -H 'authorization: Bearer ${token}' \\
  -H 'content-type: application/json' \\
  -d '{"query":"project goals","limit":5}'`,
    },
    {
      title: 'Feedback approve',
      curl: `curl -X POST '${API_URL}/v1/twins/${twinId}/feedback' \\
  -H 'authorization: Bearer ${token}' \\
  -H 'content-type: application/json' \\
  -d '{"targetType":"candidate_memory","targetId":"<candidateId>","feedbackType":"approved"}'`,
    },
    {
      title: 'Weekly reflection',
      curl: `curl -X POST '${API_URL}/v1/twins/${twinId}/reflections/weekly' \\
  -H 'authorization: Bearer ${token}' \\
  -H 'content-type: application/json' \\
  -d '{}'`,
    },
    {
      title: 'Coding agent context',
      curl: `curl '${API_URL}/v1/twins/${twinId}/engineering/context?projectName=Sivraj&includeCandidate=true' \\
  -H 'authorization: Bearer ${token}'`,
    },
    {
      title: 'Engineering instruction sources',
      curl: `curl '${API_URL}/v1/twins/${twinId}/engineering/sources' \\
  -H 'authorization: Bearer ${token}'`,
    },
    {
      title: 'Create coding-agent token',
      curl: `curl -X POST '${API_URL}/v1/twins/${twinId}/agents/tokens' \\
  -H 'authorization: Bearer ${token}' \\
  -H 'content-type: application/json' \\
  -d '{"agentName":"Codex","scopes":["agent:context:read","agent:memory:search","agent:writeback:create"],"expiresInMinutes":1440}'`,
    },
    {
      title: 'List agent writebacks',
      curl: `curl '${API_URL}/v1/twins/${twinId}/agents/writebacks?status=pending' \\
  -H 'authorization: Bearer ${token}'`,
    },
    {
      title: 'Approve agent writeback',
      curl: `curl -X POST '${API_URL}/v1/twins/${twinId}/agents/writebacks/<writebackId>/approve' \\
  -H 'authorization: Bearer ${token}' \\
  -H 'content-type: application/json' \\
  -d '{}'`,
    },
    {
      title: 'Retry failed artifact',
      curl: `curl -X POST '${API_URL}/v1/twins/${twinId}/artifacts/${artifactId || '<artifactId>'}/retry' \\
  -H 'authorization: Bearer ${token}' \\
  -H 'content-type: application/json' \\
  -d '{}'`,
    },
  ]
}
