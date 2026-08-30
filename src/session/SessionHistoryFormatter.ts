import type { SessionData } from '../types/SessionData.js'

export function formatSessionHistory(sessionData: SessionData): string {
  const conversations = sessionData.history
    .map((entry, index) => {
      const number = index + 1

      let agentResponse = entry.response.stdout
      try {
        const parsed = JSON.parse(entry.response.stdout)
        if (parsed && typeof parsed === 'object' && 'result' in parsed) {
          agentResponse = String(parsed.result)
        }
      } catch {}

      return `## ${number}. User Request

${entry.request.prompt}

## ${number}. Agent Response

${agentResponse}`
    })
    .join('\n\n')

  return `# Session History: ${sessionData.agentType}

${conversations}`
}
