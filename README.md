# Sub-Agents MCP Server

Let your AI assistant (Cursor, Claude) use specialized sub-agents for specific tasks. For example, create a "test-writer" agent that writes tests, or a "code-reviewer" agent that reviews your code.

## Why sub-agents-mcp?

While Claude Code has excellent built-in sub-agent functionality, it's exclusive to Claude Code. This MCP server brings that same powerful sub-agent pattern to **ANY LLM tool that supports MCP** - including Cursor, Windsurf, and others.

**TL;DR**: Experience Claude Code's sub-agent workflow everywhere.

→ [Read the full story](https://dev.to/shinpr/bringing-claude-codes-sub-agents-to-any-mcp-compatible-tool-1hb9)

## Prerequisites

- Node.js 20 or higher
- Cursor CLI or Claude Code installed
- Basic terminal/command line knowledge

## Installation

```bash
npx -y sub-agents-mcp
```

This command will install and run the MCP server. No manual building or cloning required!

## Quick Start (3 minutes)

### Step 1: Create Your First Agent

Create a folder for your agents and add a file `code-reviewer.md`:

```markdown
# Code Reviewer

You are a specialized AI assistant that reviews code.
Focus on:
- Finding bugs and potential issues
- Suggesting improvements
- Checking code quality
```

### Step 2: Setup Your AI Tool

**For Cursor Users:**
```bash
# Install Cursor CLI
curl https://cursor.com/install -fsS | bash

# Login (Required!)
cursor-agent login
```

**For Claude Code Users:**

```bash
# Option 1: NPM (requires Node.js 20+)
npm install -g @anthropic-ai/claude-code

# Option 2: Native install
curl -fsSL claude.ai/install.sh | bash
```

### Step 3: Configure MCP

**For Cursor:** Edit `~/.cursor/mcp.json`
**For Claude:** Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)

```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "/path/to/your/agents-folder",  // ← Must be absolute path!
        "AGENT_TYPE": "cursor"  // or "claude"
      }
    }
  }
}
```

**Path examples:**
- ✅ Good: `/Users/john/Documents/my-agents` (Mac/Linux)
- ✅ Good: `C:\\Users\\john\\Documents\\my-agents` (Windows)
- ❌ Bad: `./agents` or `~/agents` (relative paths don't work)

**That's it!** Restart your IDE and start using agents.

## How to Use

Once configured, just tell your AI assistant to use your agents:

### Examples

**Using a code reviewer:**
```
"Use the code-reviewer agent to check my UserService class"
```

**Using a test writer:**
```
"Use the test-writer agent to create unit tests for the auth module"
```

**Using a documentation writer:**
```
"Use the doc-writer agent to add JSDoc comments to all public methods"
```

Your AI will automatically invoke the specialized agent and return the results!

## Common Agent Examples

Here are some agents you might want to create:

**`test-writer.md`** - Writes comprehensive unit tests
```markdown
# Test Writer
You are specialized in writing unit tests.
- Write tests that cover edge cases
- Follow the project's testing patterns
- Ensure good coverage
```

**`sql-expert.md`** - Helps with database queries
```markdown
# SQL Expert
You are a database specialist.
- Optimize queries for performance
- Suggest proper indexes
- Help with complex JOINs
```

**`security-checker.md`** - Reviews code for security issues
```markdown
# Security Checker
You focus on finding security vulnerabilities.
- Check for SQL injection risks
- Identify authentication issues
- Find potential data leaks
```

## Configuration

### Required Settings

**`AGENTS_DIR`** - Path to your agents folder
- ⚠️ Must be an **absolute path**
  - Mac/Linux: `/Users/john/my-agents`
  - Windows: `C:\\Users\\john\\my-agents`
- Create this folder before configuring MCP

**`AGENT_TYPE`** - Which AI tool you're using
- Set to `"cursor"` for Cursor
- Set to `"claude"` for Claude Code

### Optional Settings

**`EXECUTION_TIMEOUT_MS`** - How long agents can run (default: 5 minutes)
- Increase for complex tasks like document review
- Maximum: 10 minutes (600000ms)

### Creating Agents

Each `.md` or `.txt` file in your agents folder becomes an available agent.

**File naming tips:**
- Filename = agent name (e.g., `test-writer.md` → use as "test-writer")
- Use hyphens or underscores, no spaces

**Agent file structure:**
```markdown
# Agent Name
Describe what this agent specializes in.
List its key capabilities.
```

### Security Note

Agents have access to your project directory. Only use agent definitions from trusted sources.

## Troubleshooting

### Cursor CLI Not Working

**Symptoms:** Timeout errors, authentication failures, or "session expired" messages

**Solutions:**

1. **Authenticate with cursor-agent login**
   ```bash
   cursor-agent login
   ```
   This is the standard authentication method. Run this command before using the MCP server.

2. **Check if cursor-agent is installed**
   ```bash
   which cursor-agent
   ```
   If not found, reinstall Cursor CLI.

3. **Verify session status**
   If you're still having issues, your session may have expired. Simply run `cursor-agent login` again.

### Agent Not Found

1. Verify `AGENTS_DIR` points to the correct directory
2. Check file has `.md` or `.txt` extension
3. Ensure filename contains only allowed characters

### Other Execution Errors

1. Verify `AGENT_TYPE` is set correctly (`cursor` or `claude`)
2. Ensure the CLI tool is installed and accessible:
   - For `cursor`: Ensure `cursor-agent` CLI is installed and authenticated
   - For `claude`: Ensure Claude Code CLI is installed
3. Check environment variables are properly set


## How It Works

Your AI assistant can invoke specialized agents through MCP:
1. You ask your AI to use an agent (e.g., "Use the test-writer agent")
2. The MCP server runs the specialized agent with your request
3. Results come back to your main AI assistant

## Additional Configuration Examples

### Full Configuration Reference

**For Cursor:** `~/.cursor/mcp.json`
```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "/absolute/path/to/agents",
        "AGENT_TYPE": "cursor",
        "EXECUTION_TIMEOUT_MS": "300000"  // Optional: 5 minutes default
      }
    }
  }
}
```

**For Claude:** `~/Library/Application Support/Claude/claude_desktop_config.json`
```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "/absolute/path/to/agents",
        "AGENT_TYPE": "claude",
        "EXECUTION_TIMEOUT_MS": "300000"  // Optional
      }
    }
  }
}
```

## License

MIT

---

*Enable AI-to-AI collaboration through Model Context Protocol*