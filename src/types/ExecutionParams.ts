export interface ExecutionParams {
  agent: string

  prompt: string

  cwd?: string

  extra_args?: string[]

  agentFilePath?: string
}
