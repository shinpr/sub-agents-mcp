# Sub-Agents MCP Server

MCP server that enables AI CLI tools (Cursor CLI, Claude Code) to invoke other AI agents through a standardized interface.

## Quick Start

### 1. Prepare Agent Definition Files

Create agent definition files (`.md` or `.txt`) in any directory:

```markdown
# Code Reviewer

You are a specialized AI assistant that reviews code for potential issues and improvements.

## Core Responsibilities
- Analyze provided code for quality, performance, and best practices
- Identify potential bugs and security vulnerabilities
- Suggest specific improvements with explanations

## Approach
Provide detailed, actionable feedback focusing on code quality, maintainability, and performance optimization.
```

### 2. Using with Cursor CLI

#### Install Cursor CLI
```bash
curl https://cursor.com/install -fsS | bash
```

#### Setup for MCP Integration

1. Install Cursor CLI
2. Configure your IDE's MCP settings (see MCP Configuration section)
3. Create agent definition files in your agents directory
4. Use agents through your IDE's MCP interface

### 3. Using with Claude Code

#### Install Claude Code

**Option 1: NPM Install (requires Node.js 18+)**
```bash
npm install -g @anthropic-ai/claude-code
```

**Option 2: Native Install**

*macOS/Linux/WSL:*
```bash
curl -fsSL claude.ai/install.sh | bash
```

#### Setup for MCP Integration

1. Install Claude Code
2. Configure Claude Desktop's MCP settings (see MCP Configuration section)
3. Create agent definition files in your agents directory
4. Use agents through Claude Desktop's MCP interface

For more details, see [Claude Code documentation](https://docs.anthropic.com/en/docs/claude-code).

## Installation

### Direct Execution (Recommended)

No installation required - uses the latest version from GitHub:

```bash
npx -y https://github.com/shinpr/sub-agents-mcp
```

**Note:** This command is primarily used in IDE MCP configurations, not for direct command-line execution.

## Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `AGENTS_DIR` | Directory containing agent definition files | ✓ | - |
| `CLI_COMMAND` | CLI command to execute (`cursor-agent` or `claude`) | ✓ | - |
| `CLI_API_KEY` | API key for cursor-agent (Anthropic or OpenAI API key) | ✓ (for cursor-agent) | - |
| `EXECUTION_TIMEOUT_MS` | Maximum execution time for agent operations in milliseconds (MCP->AI) | | 300000 (5 minutes) |

**Note:** For complex agents that require longer processing times (e.g., document reviewers, code analyzers), you can increase the timeout by setting `EXECUTION_TIMEOUT_MS` to a higher value, up to 600000 (10 minutes).

**Timeout Hierarchy:**
- **AI->MCP timeout**: 11 minutes (660 seconds) - Maximum time AI waits for MCP server response
- **MCP->AI timeout**: 5-10 minutes (configurable via `EXECUTION_TIMEOUT_MS`) - Maximum time MCP waits for AI response  
- **Idle timeout**: 2 minutes (120 seconds) - Time without data before terminating stuck processes

### Agent Definition Format

Place `.md` or `.txt` files in your agents directory. Agent files should contain clear, concise instructions for the AI agent:

```markdown
# Agent Name

You are a specialized AI assistant that [describes the agent's core purpose].

## Core Responsibilities
- Primary task description
- Secondary responsibilities
- Any specific constraints or guidelines

## Approach
Brief description of how the agent should approach tasks.
```

**Example: `test-writer.md`**
```markdown
# Test Writer

You are a specialized AI assistant that generates comprehensive unit tests for code.

## Core Responsibilities
- Analyze provided code and create thorough test cases
- Cover edge cases and error scenarios
- Follow project testing conventions and patterns

## Approach
Generate tests that verify functionality, handle edge cases, and maintain code coverage standards.
```

**File naming:**
- Filename becomes the agent name (without extension)
- Allowed characters: alphanumeric, hyphens, underscores
- Example: `test-writer.md` → agent name: `test-writer`

## Available Tools

### `run_agent`

Executes another agent with specified parameters.

**Parameters:**
- `agent` (required): Name of the agent to execute
- `prompt` (required): Prompt to send to the agent
- `cwd` (optional): Working directory for execution
- `extra_args` (optional): Additional command-line arguments

**Example usage in Cursor/Claude:**
```
"Use the test-writer agent to create tests for the UserService class"
```

## Troubleshooting

### Agent Not Found

1. Verify `AGENTS_DIR` points to the correct directory
2. Check file has `.md` or `.txt` extension
3. Ensure filename contains only allowed characters

### Execution Errors

1. Verify `CLI_COMMAND` is set correctly (`cursor-agent` or `claude`)
2. Ensure the CLI tool is installed and accessible
3. Check environment variables are properly set
4. For cursor-agent, ensure `CLI_API_KEY` is set with valid API key

## How It Works

This MCP server acts as a bridge between IDEs and CLI tools:

1. **IDE** (Cursor/Claude Desktop) connects to the MCP server
2. **MCP Server** receives agent execution requests
3. **MCP Server** calls the appropriate CLI tool (`cursor-agent` or `claude`)
4. **CLI Tool** executes the agent and returns results
5. **Results** are passed back through MCP to the IDE

## MCP Configuration

### Cursor IDE

Add to your project's `.cursor/claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "https://github.com/shinpr/sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "./agents",
        "CLI_COMMAND": "cursor-agent",
        "CLI_API_KEY": "your-cursor-api-key"
      }
    }
  }
}
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):
```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "https://github.com/shinpr/sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "/path/to/agents",
        "CLI_COMMAND": "claude"
      }
    }
  }
}
```

## Advanced Usage

### Using Different Agent Sets

You can use different agent directories by updating the `AGENTS_DIR` in your IDE's MCP configuration:

```json
{
  "mcpServers": {
    "sub-agents-dev": {
      "env": {
        "AGENTS_DIR": "./dev-agents"
      }
    },
    "sub-agents-prod": {
      "env": {
        "AGENTS_DIR": "./prod-agents"
      }
    }
  }
}
```

## Building from Source

```bash
# Clone repository
git clone https://github.com/shinpr/sub-agents-mcp
cd sub-agents-mcp

# Install dependencies
npm install

# Build
npm run build

# Run locally
npm start
```

## Development

```bash
# Run tests
npm test

# Run with auto-reload
npm run dev

# Check code quality
npm run check:all
```

## License

MIT

---

*Enable AI-to-AI collaboration through Model Context Protocol*