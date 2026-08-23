# Sub-Agents MCP Server

[![npm version](https://img.shields.io/npm/v/sub-agents-mcp.svg)](https://www.npmjs.com/package/sub-agents-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Bring Claude Code–style sub-agents to any MCP-compatible tool.

Define task-specific AI agents such as "test-writer" or "code-reviewer" in Markdown files. The server runs them through Cursor CLI, Claude Code, Codex, Google Antigravity, Gemini CLI, GLM, Kimi, Grok Build, or OpenCode.

## Why?

Claude Code supports sub-agents within its own environment. This server exposes the same type of workflow through MCP, allowing clients such as Cursor, Claude Desktop, and Windsurf to use the agent definitions.

**What it provides:**
- Define reusable agents once, use them across multiple tools
- Share agent definitions within teams regardless of IDE choice
- Select Cursor CLI, Claude Code, Codex, Google Antigravity, Gemini CLI, GLM, Kimi, Grok Build, or OpenCode as the execution backend

→ [Read the full story](https://dev.to/shinpr/bringing-claude-codes-sub-agents-to-any-mcp-compatible-tool-1hb9)

## Alternative: Agent Skills

[sub-agents-skills](https://github.com/shinpr/sub-agents-skills) offers a lightweight alternative.

| | sub-agents-mcp | sub-agents-skills |
|---|---|---|
| **Setup** | MCP configuration required | Copy skill files to your environment |
| **Configuration** | One backend/model policy per MCP server | Backend/model/permission per agent frontmatter |
| **Agent discovery** | Fixed `AGENTS_DIR` | Project-local `.agents` or `SUB_AGENTS_DIR` |
| **Strengths** | Sessions, MCP resources, structured responses, centralized policy | Lightweight setup and mixed backends in one project |

Choose **sub-agents-mcp** when you want a centrally configured execution service. Choose **sub-agents-skills** when each agent should select its own backend and model in a Skill-compatible environment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Usage Examples](#usage-examples)
- [Writing Effective Agents](#writing-effective-agents)
- [Agent Examples](#agent-examples)
- [Configuration Reference](#configuration-reference)
- [Session Management](#session-management)
- [Troubleshooting](#troubleshooting)
- [Design Philosophy](#design-philosophy)
- [How It Works](#how-it-works)

## Prerequisites

- Node.js 22 or higher
- One of these execution engines (they actually run the sub-agents):
  - `cursor-agent` CLI (from Cursor)
  - `claude` CLI (from Claude Code)
  - `codex` CLI (from Codex)
  - `gemini` CLI (from Gemini CLI; requires `GEMINI_API_KEY`)
  - `glm` backend (uses the Claude Code `claude` CLI with a Z.ai token)
  - `kimi` backend (uses the Claude Code `claude` CLI with a Kimi API key)
  - `grok` CLI (from Grok Build)
  - `agy` CLI 1.1.12 or later (from Google Antigravity)
  - `opencode` CLI (from OpenCode)
- An MCP-compatible tool (Cursor IDE, Claude Desktop, Windsurf, etc.)

## Quick Start

### 1. Create Your First Agent

Create a folder for your agents and add `code-reviewer.md`:

```markdown
# Code Reviewer

Review code for quality and maintainability issues.

## Task
- Find bugs and potential issues
- Suggest improvements
- Check code style consistency

## Done When
- All target files reviewed
- Issues listed with explanations
```

See [Writing Effective Agents](#writing-effective-agents) for more on agent design.

### 2. Install Your Execution Engine

Pick one based on which tool you use:

**For Cursor users:**
```bash
# Install Cursor CLI (includes cursor-agent)
curl https://cursor.com/install -fsS | bash

# Authenticate (required before first use)
cursor-agent login
```

**For Claude Code users:**
```bash
# Option 1: Native install (recommended)
curl -fsSL https://claude.ai/install.sh | bash

# Option 2: NPM (requires Node.js 18+)
npm install -g @anthropic-ai/claude-code
```

Note: Claude Code installs the `claude` CLI command.

**For Codex users:**
```bash
# Install Codex
npm install -g @openai/codex
```

**For Gemini CLI users:**
```bash
# Install Gemini CLI
npm install -g @google/gemini-cli

# Set a Gemini API key in the MCP server environment
export GEMINI_API_KEY="your-key"
```

Note: Set `GEMINI_API_KEY` for the `gemini` backend. Google is retiring the free OAuth tier on June 18, 2026.

**For GLM (Z.ai) users:**
```bash
# Install Claude Code; GLM uses the claude binary against Z.ai's endpoint
curl -fsSL https://claude.ai/install.sh | bash
```

Set `AGENT_TYPE` to `glm` and add `CLI_API_KEY` to the MCP server environment in your MCP client configuration. Because MCP servers are long-running processes, restart or reconnect the MCP server after changing `CLI_API_KEY`.

**For Kimi users:**
```bash
# Install Claude Code; Kimi uses the claude binary against Kimi's coding endpoint
curl -fsSL https://claude.ai/install.sh | bash
```

Set `AGENT_TYPE` to `kimi` and add your Kimi API key as `CLI_API_KEY` in the MCP server environment. The key is passed to the child process through the environment, never through CLI arguments. Restart or reconnect the MCP server after changing it.

**For Grok Build users:**
```bash
# Install Grok Build
curl -fsSL https://x.ai/cli/install.sh | bash
```

**For Google Antigravity users:**
```bash
# Install Antigravity CLI 1.1.12 or later
curl -fsSL https://antigravity.google/cli/install.sh | bash

# Authenticate before starting the MCP server
agy
```

**For OpenCode users:**
```bash
brew install anomalyco/tap/opencode
```

Configure providers and credentials in OpenCode normally. Each MCP invocation uses isolated data and state directories to avoid concurrent session database locks while continuing to use your normal configuration and credentials.

### 3. Configure MCP

Add this to your MCP configuration file:

**Cursor:** `~/.cursor/mcp.json`
**Claude Desktop:** `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "/absolute/path/to/your/agents-folder",
        "AGENT_TYPE": "cursor"  // or "claude", "codex", "antigravity", "gemini", "glm", "kimi", "grok", or "opencode"
      }
    }
  }
}
```

**Important:** Use absolute paths only.
- ✅ `/Users/john/Documents/my-agents` (Mac/Linux)
- ✅ `C:\\Users\\john\\Documents\\my-agents` (Windows)
- ❌ `./agents` or `~/agents` won't work

Restart your IDE and you're ready to go.

### 4. Fix "Permission Denied" Errors When Running Shell Commands

Sub-agents may fail to execute shell commands with permission errors. This happens because sub-agents can't respond to interactive permission prompts.

**Recommended approach:**

1. Run your CLI tool directly with the task you want sub-agents to handle:
   ```bash
   # For Cursor users
   cursor-agent

   # For Claude Code users
   claude

   # For Codex CLI users
   codex

   # For Gemini CLI users
   gemini

   # For Grok Build users
   grok

   # For Google Antigravity users
   agy

   # For OpenCode users
   opencode
   ```

2. When prompted to allow commands (e.g., "Add Shell(cd), Shell(make) to allowlist?"), approve them

3. This automatically updates your configuration file, and those commands will now work when invoked via MCP sub-agents

**Manual configuration (alternative):**

If you prefer to configure permissions manually, edit:
- **Cursor**: `<project>/.cursor/cli.json` or `~/.cursor/cli-config.json`
- **Claude Code**: `.claude/settings.json` or `.claude/settings.local.json`

```json
{
  "permissions": {
    "allow": [
      "Shell(cd)",
      "Shell(make)",
      "Shell(git)"
    ]
  }
}
```

Note: Agents often run commands as one-liners like `cd /path && make build`, so you need to allow all parts of the command.

## Usage Examples

Ask your AI tool to use an agent:

```
"Use the code-reviewer agent to check my UserService class"
```

```
"Use the test-writer agent to create unit tests for the auth module"
```

```
"Use the doc-writer agent to add JSDoc comments to all public methods"
```

The AI tool calls the MCP server, which runs the selected agent and returns its result.

**Tip:** Include *what you want done* in the request, not only the agent name. For example:

- **Specific:** "Use the code-reviewer agent **to check my UserService class**"
- **Incomplete:** "Use the code-reviewer agent" (the review target is missing)

The more specific your task, the better the results.

## Writing Effective Agents

### The Single Responsibility Principle

Each agent should do **one thing well**. Avoid "swiss army knife" agents.

| ✅ Good | ❌ Bad |
|---------|--------|
| Reviews code for security issues | Reviews code, writes tests, and refactors |
| Writes unit tests for a module | Writes tests and fixes bugs it finds |

### Essential Structure

```markdown
# Agent Name

One-sentence purpose.

## Task
- Action 1
- Action 2

## Done When
- Criterion 1
- Criterion 2
```

### Keep Agents Self-Contained

Agents run in isolation with fresh context. Avoid:

- References to other agents ("then use X agent...")
- Assumptions about prior context ("continuing from before...")
- Scope creep beyond the stated purpose

### Optional Agent Sections

For complex agents, consider adding:

- **Scope boundaries**: Explicitly state what's *out of scope*
- **Prohibited actions**: List common mistakes the agent should avoid
- **Output format**: Define structured output when needed

## Agent Examples

Each `.md` or `.txt` file in your agents folder becomes an agent. The filename becomes the agent name (e.g., `bug-investigator.md` → "bug-investigator").

**`bug-investigator.md`**
```markdown
# Bug Investigator

Investigate bug reports and identify root causes.

## Task
- Collect evidence from error logs, code, and git history
- Generate multiple hypotheses for the cause
- Trace each hypothesis to its root cause
- Report findings with supporting evidence

## Out of Scope
- Fixing the bug (investigation only)
- Making assumptions without evidence

## Done When
- At least 2 hypotheses documented with evidence
- Most likely cause identified with confidence level
- Affected code locations listed
```

For examples with completion checklists, prohibited actions, and structured output, see [claude-code-workflows/agents](https://github.com/shinpr/claude-code-workflows/tree/main/agents). These examples target Claude Code, but the same structure applies to any execution engine.

## Configuration Reference

### Required Environment Variables

**`AGENTS_DIR`**
Path to your agents folder. Must be absolute.

**`AGENT_TYPE`**
Which execution engine to use:
- `"cursor"` - uses `cursor-agent` CLI
- `"claude"` - uses `claude` CLI
- `"gemini"` - uses `gemini` CLI
- `"codex"` - uses `codex` CLI (OpenAI Codex)
- `"glm"` - uses the Claude Code `claude` CLI against GLM's Z.ai endpoint
- `"kimi"` - uses the Claude Code `claude` CLI against Kimi's coding endpoint
- `"grok"` - uses `grok` CLI (Grok Build)
- `"antigravity"` - uses `agy` CLI (Google Antigravity; requires version 1.1.12 or later)
- `"opencode"` - uses `opencode` CLI and its configured provider

`AGENT_TYPE` has no default. The MCP server returns a corrective startup error when it is missing or blank.

### Optional Settings

**`AGENT_PERMISSION`**
Approval/sandbox level the sub-agent runs with. Default: `"safe-edit"`.

- `"read-only"`: investigation/review only, no edits or shell writes (codex `-s read-only` / claude+glm+kimi `--permission-mode plan` / gemini `--approval-mode plan` / cursor `--mode plan --sandbox enabled` / grok `--sandbox read-only` / antigravity `--mode plan --sandbox` / OpenCode deny rules)
- `"safe-edit"`: auto-approve edits and suppress prompts (codex `-s workspace-write` + `approval_policy=never` / claude+glm+kimi `--permission-mode acceptEdits` / gemini `--approval-mode auto_edit` / cursor `--trust --sandbox enabled` / grok `--sandbox workspace` / antigravity `--mode accept-edits --sandbox` / OpenCode permission rules)
- `"yolo"`: bypass all approvals and sandboxing. Use with care.

Sub-agents have no stdin, so any approval prompt would deadlock the run. The default `safe-edit` removes prompts, but sandboxing depends on the CLI. Codex, Cursor, Grok, and Antigravity enforce a workspace-level sandbox for `safe-edit`, while Claude, GLM, Kimi, and Gemini only auto-approve and do not confine edits to the workspace. OpenCode's permission configuration is also not an OS-level sandbox and cannot confine every side effect of programs launched through bash. Cursor combines `--mode plan` with its shell sandbox for `read-only`; the mode prevents edits while the sandbox confines supported shell commands. Grok fixes `--permission-mode bypassPermissions` and uses the kernel-enforced `--sandbox` profile to confine writes per `AGENT_PERMISSION`. Antigravity uses `--sandbox` for `read-only` and `safe-edit`, and omits it only for `yolo`. If you need strict containment, use a sandbox-backed backend.

OpenCode custom and MCP tools follow your OpenCode permissions even in `read-only`; explicitly deny any added tool that can cause side effects.

**`AGENT_MODEL`**
Optional model override applied to every execution by this MCP server. The value is passed to the selected backend as `--model`. When omitted, the backend uses its configured default.

```json
"AGENT_MODEL": "gpt-5.6-luna"
```

OpenCode model names normally use `provider/model` syntax.

**`AGENT_EFFORT`**
Optional backend/model-specific reasoning level or model variant. It is passed to Codex as `model_reasoning_effort`, Claude/GLM/Kimi/Antigravity as `--effort`, Grok as `--reasoning-effort`, and OpenCode as `--variant`. Cursor and Gemini do not support this setting; the MCP server rejects that configuration at startup.

Accepted values depend on the selected backend and model. The MCP server forwards the value unchanged.

**`CLI_API_KEY`**
Provider API key for `AGENT_TYPE=glm` or `kimi`. For GLM it is forwarded to the Claude Code binary as `ANTHROPIC_AUTH_TOKEN`; for Kimi it is forwarded as `ANTHROPIC_API_KEY`. It is never passed as a CLI argument. If you add or change it in your MCP client configuration, restart or reconnect the MCP server so the running process receives the new environment.

**`EXECUTION_TIMEOUT_MS`**
How long agents can run before timing out (default: 5 minutes, max: 10 minutes)

**`AGENTS_SETTINGS_PATH`**
Path to custom CLI settings directory for sub-agents.

Each CLI normally reads settings from project-level directories (`.claude/`, `.cursor/`, `.codex/`) or user-level directories (`~/.claude/`, `~/.cursor/`, `~/.codex/`). If you want sub-agents to run with different settings (e.g., different permissions or model), specify a separate settings directory here.

Applied to: `claude`, `cursor`, `codex`.

Note: Gemini CLI, Grok Build, Google Antigravity, and OpenCode do not use this option, so it has no effect when `AGENT_TYPE` is `gemini`, `grok`, `antigravity`, or `opencode`. OpenCode continues its normal XDG/project configuration discovery. The `glm` and `kimi` backends also ignore this setting to avoid mixing Claude settings and credentials into redirected subprocesses.

Example with custom settings:
```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "/absolute/path/to/agents",
        "AGENT_TYPE": "cursor",
        "EXECUTION_TIMEOUT_MS": "600000",
        "AGENTS_SETTINGS_PATH": "/absolute/path/to/custom-cli-settings"
      }
    }
  }
}
```

### Security Note

Agents have access to your project directory. Only use agent definitions from trusted sources.

## Session Management

Session management allows sub-agents to remember previous executions, which helps when you want agents to build on earlier work or maintain context across multiple calls.

### Why Sessions Matter

By default, each sub-agent execution starts with no context. With sessions enabled:
- Agents can reference their earlier work
- You get execution history for debugging
- Related tasks share context

### Enabling Sessions

Add these environment variables to your MCP configuration:

```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "/absolute/path/to/agents",
        "AGENT_TYPE": "cursor",
        "SESSION_ENABLED": "true",
        "SESSION_DIR": "/absolute/path/to/session-storage",
        "SESSION_RETENTION_DAYS": "1"
      }
    }
  }
}
```

**Configuration options:**

- `SESSION_ENABLED` - Set to `"true"` to enable session management (default: `false`)
- `SESSION_DIR` - Where to store session files (default: `.mcp-sessions` in the current working directory)
- `SESSION_RETENTION_DAYS` - How long to keep session files based on last modification time in days (default: 1)

**Security consideration:** Session files contain execution history and may include sensitive information. Use absolute paths for `SESSION_DIR`.

### When to Use Sessions

Sessions work well for:
- **Iterative development**: "Based on your earlier findings, now fix the issues"
- **Multi-step workflows**: Breaking complex tasks into smaller sub-agent calls
- **Debugging**: Reviewing exactly what was executed and what results were returned

Note that sessions require additional storage and processing overhead.

### How Session Continuity Works

When sessions are enabled, the MCP response includes a `session_id` field. To continue the same session, pass this ID back in the next request.

**Important:** Your AI assistant must explicitly include the session_id in subsequent requests. While some assistants may do this automatically, it's not guaranteed. For reliable session continuity, add explicit instructions to your prompts or project rules.

**Example prompt instruction:**
```markdown
When using sub-agents with sessions enabled, always include the session_id
from the previous response in your next request to maintain context.
```

**Example project rule (e.g., `AGENTS.md`):**
```markdown
# Sub-Agent Session Guidelines

When calling the same sub-agent multiple times:
1. Extract the session_id from the MCP response
2. Pass it as a parameter in subsequent calls
3. This preserves context between executions
```

## Troubleshooting

### Timeout errors or authentication failures

**If using Cursor CLI:**
Run `cursor-agent login` to authenticate. If the session expires, run the command again.

Verify installation:
```bash
which cursor-agent
```

**If using Claude Code:**
Make sure the CLI is properly installed and accessible.

**If using GLM (Z.ai):**
Make sure the Claude Code `claude` CLI is installed, then set `CLI_API_KEY` to your Z.ai token in the MCP server environment. Restart or reconnect the MCP server after changing MCP environment variables.

**If using Kimi:**
Make sure the Claude Code `claude` CLI is installed, then set `CLI_API_KEY` to your Kimi API key in the MCP server environment. Restart or reconnect the MCP server after changing MCP environment variables.

**If using Grok Build:**
Make sure the `grok` CLI is installed and accessible.

**If using Google Antigravity:**
Make sure Antigravity CLI 1.1.12 or later is installed, then run `agy` once to authenticate before starting the MCP server.

**If using OpenCode:**
Make sure the `opencode` CLI is installed and that its provider credentials are configured. The MCP server gives every invocation an isolated OpenCode data/state directory to prevent concurrent SQLite session locks.

### Agent not found

Check that:
- `AGENTS_DIR` points to the correct directory (use absolute path)
- Your agent file has `.md` or `.txt` extension
- The filename uses hyphens or underscores (no spaces)

### Other execution errors

1. Verify `AGENT_TYPE` is set correctly (`cursor`, `claude`, `gemini`, `codex`, `glm`, `kimi`, `grok`, `antigravity`, or `opencode`)
2. Confirm that your chosen CLI tool is installed and accessible
3. Double-check that all environment variables are set in the MCP config

### Recursive sub-agent calls (infinite loop)

If sub-agents keep spawning more sub-agents, there are typically two causes:

**1. MCP configuration inheritance**

Create a separate settings directory without the sub-agents MCP configuration and specify it via `AGENTS_SETTINGS_PATH`. This prevents sub-agents from having access to this MCP server.

**2. AGENTS.md instruction inheritance (Codex)**

Codex concatenates AGENTS.md from CODEX_HOME and project root. If your project AGENTS.md has delegation instructions, sub-agents inherit them too.

Solution: Don't place AGENTS.md at the project root. Use separate directories:
```
/your-project
├── .codex-main/AGENTS.md      # Main agent instructions
├── .codex-sub/AGENTS.md       # Sub-agent instructions (no delegation)
└── (no AGENTS.md at root)
```

- Run main Codex with `CODEX_HOME=/your-project/.codex-main`
- Set `AGENTS_SETTINGS_PATH=/your-project/.codex-sub` in sub-agents-mcp config

## Design Philosophy

### Why Independent Contexts Matter

Every sub-agent starts with a fresh context. Each call has some startup overhead, and tasks run without state left over from previous runs.

**Context Isolation**
- Each agent only receives the information relevant to its task
- No context leakage between runs
- The main agent stays focused and lightweight

**Accuracy and Reliability**
- Sub-agents can specialize in a single goal without interference
- Less risk of confusion from unrelated context
- More consistent results in complex, multi-step workflows

**Scalability**
- Large tasks can be safely split into smaller sub-tasks
- Each sub-agent operates within its own token limit
- The main agent coordinates without hitting global context limits

The startup overhead is an intentional trade-off: the system favors clarity and accuracy over raw execution speed.

## How It Works

This MCP server acts as a bridge between your AI tool and a supported execution engine (Cursor CLI, Claude Code, Google Antigravity, Gemini CLI, Codex, GLM via Z.ai, Kimi, Grok Build, or OpenCode).

**The flow:**

1. You configure the MCP server in your client (Cursor, Claude Desktop, etc.)
2. The client automatically launches `sub-agents-mcp` as a background process when it starts
3. When your main AI assistant needs a sub-agent, it makes an MCP tool call
4. The MCP server reads the agent definition (markdown file) and invokes the globally configured CLI (`cursor-agent`, `claude`, `agy`, `gemini`, `codex`, `glm`/`kimi` via the `claude` binary, `grok`, or `opencode`)
5. The execution engine runs the agent and streams results back through the MCP server
6. Your main assistant receives the results and continues working

This architecture lets any MCP-compatible tool benefit from specialized sub-agents, even if it doesn't have native support.

## License

MIT

---

*AI-to-AI collaboration through Model Context Protocol*
