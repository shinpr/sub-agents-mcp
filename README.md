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

**⚠️ Important Note for Cursor CLI Users:**
If you encounter timeout errors when using the MCP server with Cursor CLI, your login session may have expired. Please re-authenticate using:
```bash
cursor-agent login
```
This is required periodically as Cursor CLI sessions expire and need to be renewed.

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
| `AGENTS_DIR` | Directory containing agent definition files | | `./agents` |
| `AGENT_TYPE` | Type of agent to use (`cursor` or `claude`) | | `cursor` |
| `CLI_API_KEY` | API key for cursor-agent (Anthropic or OpenAI API key) | ✓ (for cursor) | - |
| `EXECUTION_TIMEOUT_MS` | Maximum execution time for agent operations in milliseconds (MCP->AI) | | 300000 (5 minutes) |

**Note:** For complex agents that require longer processing times (e.g., document reviewers, code analyzers), you can increase the timeout by setting `EXECUTION_TIMEOUT_MS` to a higher value, up to 600000 (10 minutes).

### Execution Timeout

The system implements a single, configurable timeout for agent execution:

- **MCP→AI Execution Timeout**: 5 minutes (300000ms default)
  - Time MCP waits for AI agent execution to complete
  - Configurable via `EXECUTION_TIMEOUT_MS` environment variable
  - Range: 1 second to 10 minutes (1000ms - 600000ms)
  - Controls the maximum time an agent can run before being terminated

When an agent execution exceeds the timeout, the process is terminated with exit code 124.

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

1. Verify `AGENT_TYPE` is set correctly (`cursor` or `claude`)
2. Ensure the CLI tool is installed and accessible:
   - For `cursor`: Ensure `cursor-agent` CLI is installed
   - For `claude`: Ensure Claude Code CLI is installed
3. Check environment variables are properly set
4. For cursor agent type, ensure `CLI_API_KEY` is set with valid API key

## How It Works

This MCP server acts as a bridge between IDEs and CLI tools:

1. **IDE** (Cursor/Claude Desktop) connects to the MCP server
2. **MCP Server** receives agent execution requests via the `run_agent` tool
3. **MCP Server** determines the CLI command based on `AGENT_TYPE`:
   - `cursor`: Executes via `cursor-agent` CLI
   - `claude`: Executes via `claude` CLI with `--output-format json`
4. **Stream Processing**: Unified handling of output streams
   - For Cursor: Waits for `{"type": "result"}` JSON to signal completion
   - For Claude: Captures the first complete JSON response
5. **Results** are passed back through MCP to the IDE

## MCP Configuration

### Cursor IDE

Add to your project's `.cursor/mcp_config.json` (or appropriate MCP config file):
```json
{
  "mcpServers": {
    "sub-agents": {
      "command": "npx",
      "args": ["-y", "https://github.com/shinpr/sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "./agents",
        "AGENT_TYPE": "cursor",
        "CLI_API_KEY": "your-api-key"
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
        "AGENT_TYPE": "claude"
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
      "command": "npx",
      "args": ["-y", "https://github.com/shinpr/sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "./dev-agents",
        "AGENT_TYPE": "cursor",
        "CLI_API_KEY": "your-api-key"
      }
    },
    "sub-agents-prod": {
      "command": "npx",
      "args": ["-y", "https://github.com/shinpr/sub-agents-mcp"],
      "env": {
        "AGENTS_DIR": "./prod-agents",
        "AGENT_TYPE": "cursor",
        "CLI_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Architecture Details

#### Stream Processing
The server uses a unified `StreamProcessor` class to handle output from both Cursor and Claude agents:
- **Cursor**: Streams multiple JSON objects, ends with `{"type": "result", ...}`
- **Claude**: Returns a single JSON response when using `--output-format json`
- Both formats are processed to extract the final result JSON

#### Agent Management
- Agents are loaded dynamically from the configured `AGENTS_DIR`
- Each `.md` or `.txt` file becomes an available agent
- Agent content is passed as system context to the CLI tool

#### Error Handling
- Comprehensive error recovery with retry logic for transient failures
- Graceful timeout handling with proper process cleanup
- Detailed logging at multiple levels (debug, info, warn, error)

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