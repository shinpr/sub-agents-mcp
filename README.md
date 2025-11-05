# Sub-Agents MCP Server

[![npm version](https://img.shields.io/npm/v/sub-agents-mcp.svg)](https://www.npmjs.com/package/sub-agents-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Bring Claude Code–style sub-agents to any MCP-compatible tool.

This MCP server lets you define task-specific AI agents (like "test-writer" or "code-reviewer") in markdown files, and execute them via Cursor CLI or Claude Code CLI backends.

## Why?

Claude Code offers powerful sub-agent workflows—but they're limited to its own environment. This MCP server makes that workflow portable, so any MCP-compatible tool (Cursor, Claude Desktop, Windsurf, etc.) can use the same agents.

**Concrete benefits:**
- Define reusable agents once, use them across multiple tools
- Share agent definitions within teams regardless of IDE choice
- Leverage Cursor CLI or Claude Code CLI capabilities from any MCP client

→ [Read the full story](https://dev.to/shinpr/bringing-claude-codes-sub-agents-to-any-mcp-compatible-tool-1hb9)

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Usage Examples](#usage-examples)
- [Agent Examples](#agent-examples)
- [Configuration Reference](#configuration-reference)
- [Troubleshooting](#troubleshooting)
- [How It Works](#how-it-works)

## Prerequisites

- Node.js 20 or higher
- One of these execution engines (they actually run the sub-agents):
  - `cursor-agent` CLI (from Cursor)
  - `claude` CLI (from Claude Code)
- An MCP-compatible tool (Cursor IDE, Claude Desktop, Windsurf, etc.)

## Quick Start

### 1. Create Your First Agent

Create a folder for your agents and add `code-reviewer.md`:

```markdown
# Code Reviewer

You are a specialized AI assistant that reviews code.
Focus on:
- Finding bugs and potential issues
- Suggesting improvements
- Checking code quality
```

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
# Option 1: NPM (requires Node.js 20+)
npm install -g @anthropic-ai/claude-code

# Option 2: Native install
curl -fsSL claude.ai/install.sh | bash
```

Note: Claude Code installs the `claude` CLI command.

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
        "AGENT_TYPE": "cursor"  // or "claude"
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

## Usage Examples

Just tell your AI to use an agent:

```
"Use the code-reviewer agent to check my UserService class"
```

```
"Use the test-writer agent to create unit tests for the auth module"
```

```
"Use the doc-writer agent to add JSDoc comments to all public methods"
```

Your AI automatically invokes the specialized agent and returns results.

## Agent Examples

Each `.md` or `.txt` file in your agents folder becomes an agent. The filename becomes the agent name (e.g., `test-writer.md` → "test-writer").

### Test Writer

**`test-writer.md`**
```markdown
# Test Writer
You specialize in writing comprehensive unit tests.
- Cover edge cases
- Follow project testing patterns
- Ensure good coverage
```

### SQL Expert

**`sql-expert.md`**
```markdown
# SQL Expert
You're a database specialist who helps with queries.
- Optimize for performance
- Suggest proper indexes
- Help with complex JOINs
```

### Security Checker

**`security-checker.md`**
```markdown
# Security Checker
You focus on finding security vulnerabilities.
- Check for SQL injection risks
- Identify authentication issues
- Find potential data leaks
```

## Configuration Reference

### Required Environment Variables

**`AGENTS_DIR`**
Path to your agents folder. Must be absolute.

**`AGENT_TYPE`**
Which execution engine to use:
- `"cursor"` - uses `cursor-agent` CLI
- `"claude"` - uses `claude` CLI

### Optional Settings

**`EXECUTION_TIMEOUT_MS`**
How long agents can run before timing out (default: 5 minutes, max: 10 minutes)

Example with timeout:
```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "/absolute/path/to/agents",
        "AGENT_TYPE": "cursor",
        "EXECUTION_TIMEOUT_MS": "600000"
      }
    }
  }
}
```

### Security Note

Agents have access to your project directory. Only use agent definitions from trusted sources.

## Troubleshooting

### Timeout errors or authentication failures

**If using Cursor CLI:**
Run `cursor-agent login` to authenticate. Sessions can expire, so just run this command again if you see auth errors.

Verify installation:
```bash
which cursor-agent
```

**If using Claude Code:**
Make sure the CLI is properly installed and accessible.

### Agent not found

Check that:
- `AGENTS_DIR` points to the correct directory (use absolute path)
- Your agent file has `.md` or `.txt` extension
- The filename uses hyphens or underscores (no spaces)

### Other execution errors

1. Verify `AGENT_TYPE` is set correctly (`cursor` or `claude`)
2. Ensure your chosen CLI tool is installed and accessible
3. Double-check that all environment variables are set in the MCP config

## How It Works

This MCP server acts as a bridge between your AI tool and a supported execution engine (Cursor CLI or Claude Code CLI).

**The flow:**

1. You configure the MCP server in your client (Cursor, Claude Desktop, etc.)
2. The client automatically launches `sub-agents-mcp` as a background process when it starts
3. When your main AI assistant needs a sub-agent, it makes an MCP tool call
4. The MCP server reads the agent definition (markdown file) and invokes the selected CLI (`cursor-agent` or `claude`)
5. The execution engine runs the agent and streams results back through the MCP server
6. Your main assistant receives the results and continues working

This architecture lets any MCP-compatible tool benefit from specialized sub-agents, even if it doesn't have native support.

## License

MIT

---

*AI-to-AI collaboration through Model Context Protocol*
