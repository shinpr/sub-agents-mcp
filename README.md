# Sub-Agents MCP Server

[![npm version](https://img.shields.io/npm/v/sub-agents-mcp.svg)](https://www.npmjs.com/package/sub-agents-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Run reusable coding agents from any MCP-compatible client.

Write a reviewer, test writer, or investigator in Markdown, then ask your assistant to use it. The MCP server runs that agent with the coding CLI you choose and returns the result to the same conversation.

## What You Can Do

- Delegate code review, test writing, investigation, and documentation to focused agents
- Reuse the same agent definitions across MCP clients with one shared backend and model configuration
- Continue the same agent across multiple calls for longer work

## Quick Start

You need Node.js 22 or later, an MCP-compatible client, and one supported coding CLI installed and signed in. This example uses Codex.

### 1. Create an Agent

Create an agents folder anywhere on your machine, then add `code-reviewer.md`:

```markdown
# Code Reviewer

Review code for bugs and maintainability issues.

## Task

- Find concrete problems in the requested changes
- Explain why each problem matters
- Point to the affected code

## Done When

- All requested files have been reviewed
- Findings include evidence and suggested next steps
```

The filename becomes the agent name: `code-reviewer.md` becomes `code-reviewer`.

### 2. Add the MCP Server

Add the server to your client's MCP configuration. Replace `AGENTS_DIR` with the absolute path to the folder you created.

```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "/absolute/path/to/agents",
        "AGENT_TYPE": "codex"
      }
    }
  }
}
```

Restart or reconnect your MCP client after saving the configuration.

### 3. Run the Agent

Ask your assistant:

```text
Use the code-reviewer agent to review the authentication changes.
```

Your assistant runs the agent with Codex and returns the review to the conversation.

## Examples

```text
Use the test-writer agent to add unit tests for the auth module.
```

```text
Use the bug-investigator agent to find the cause of the failed checkout requests.
```

```text
Use the doc-writer agent to document the public API changes.
```

Name both the agent and the work you want it to do.

## When the MCP Server Fits

Use the MCP server when you want to share the same agents across MCP clients while keeping backend and model configuration in one place.

If you prefer a lighter installation or want each agent to choose its own backend and model, see [Sub-Agents Skills](https://github.com/shinpr/sub-agents-skills).

## Supported Backends

Set `AGENT_TYPE` to the backend you already use:

| `AGENT_TYPE` | Backend | Command |
|---|---|---|
| `codex` | Codex | `codex` |
| `claude` | Claude Code | `claude` |
| `cursor` | Cursor CLI | `cursor-agent` |
| `command-code` | Command Code | `command-code` |
| `glm` | GLM (Z.ai) | `claude` |
| `kimi` | Kimi | `claude` |
| `grok` | Grok Build | `grok` |
| `antigravity` | Google Antigravity | `agy` 1.1.12+ |
| `gemini` | Gemini CLI (compatibility) | `gemini` |
| `opencode` | OpenCode | `opencode` |

The selected CLI must be installed and configured before the MCP server starts.

GLM and Kimi require `CLI_API_KEY` in the MCP server environment. Other backends use the CLI's existing authentication.

For Google models, prefer Antigravity. Gemini CLI remains available for existing enterprise, API key, or Vertex AI configurations.

## Shared Agent Settings

Set `AGENT_MODEL` to use one model for every agent. Omit it to use the backend's default.

`AGENT_PERMISSION` controls what agents may do:

- `read-only` — review and investigation
- `safe-edit` — edits allowed without approval (default)
- `yolo` — unrestricted execution

If an agent reports that an action was blocked, choose a less restrictive mode.

## Continue Work Across Calls

Set `SESSION_ENABLED` to `"true"` when you want an agent to remember earlier calls and continue a longer task. Your assistant must reuse the returned `session_id` on the next call to continue that session.

## If It Does Not Start

- Run the selected backend command directly and confirm that it is installed and signed in
- Make sure `AGENTS_DIR` is an absolute path and contains at least one `.md` or `.txt` file
- Restart or reconnect the MCP client after changing its configuration

## License

MIT
