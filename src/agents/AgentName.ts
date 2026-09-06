/**
 * The one naming rule shared by agent discovery, `getAgent`, the `run_agent`
 * tool input, and resource URIs. Keeping a single definition is what prevents an
 * agent from being listed under a name that cannot then be executed.
 */
export const AGENT_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

const MAX_AGENT_NAME_LENGTH = 100

/**
 * Returns why `name` is unusable as an agent name, or undefined when it is
 * valid. The text is written to be shown to the user verbatim.
 */
export function agentNameProblem(name: unknown): string | undefined {
  if (typeof name !== 'string' || name.length === 0) {
    return 'an agent name is required'
  }
  if (name.trim().length === 0) {
    return 'an agent name cannot be blank'
  }
  if (name.length > MAX_AGENT_NAME_LENGTH) {
    return `an agent name may be at most ${MAX_AGENT_NAME_LENGTH} characters (got ${name.length})`
  }
  if (!AGENT_NAME_PATTERN.test(name)) {
    return 'an agent name may only contain letters, digits, hyphens and underscores'
  }
  return undefined
}

export function isValidAgentName(name: unknown): name is string {
  return agentNameProblem(name) === undefined
}

/** Best-effort rename suggestion shown alongside a skipped definition file. */
export function suggestAgentName(name: string): string {
  const suggestion = name
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_AGENT_NAME_LENGTH)
  return suggestion.length > 0 ? suggestion : 'agent'
}
