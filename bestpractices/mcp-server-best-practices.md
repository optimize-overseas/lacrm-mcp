# MCP Server Development Best Practices and Standards

Building effective Model Context Protocol (MCP) servers requires understanding the protocol fundamentals, implementing language-specific patterns correctly, and following security and operational best practices. This document provides actionable guidance for creating production-ready MCP servers using the official TypeScript and Python SDKs, with comprehensive coverage of architecture patterns, security, testing, and deployment strategies.

---

## Protocol fundamentals shape every implementation decision

The Model Context Protocol uses a **client-host-server architecture** with JSON-RPC 2.0 messaging. The **host** (Claude Desktop, VS Code, Cursor) manages multiple **clients**, each maintaining a 1:1 connection with an **MCP server** that provides tools, resources, and prompts.

### Core primitives

| Primitive | Control | Purpose |
|-----------|---------|---------|
| **Tools** | Model-controlled | Executable functions the LLM can invoke |
| **Resources** | Application-controlled | Data sources identified by URIs |
| **Prompts** | User-controlled | Reusable interaction templates |
| **Sampling** | Server-initiated | Allows servers to request LLM completions |

### Transport mechanisms

**STDIO** (local): Server runs as subprocess, communicating via stdin/stdout. Best for CLI tools, local file access, and development environments. Messages must be newline-delimited with no embedded newlines.

**Streamable HTTP** (remote, recommended): Single HTTP endpoint supporting POST for requests and optional SSE for streaming responses. Supports session management via `Mcp-Session-Id` header and OAuth 2.1 authentication.

**SSE** (deprecated): Legacy transport replaced by Streamable HTTP as of protocol version 2025-03-26.

### Protocol lifecycle

Every MCP connection follows three phases:

**1. Initialization**: Client sends `initialize` request with protocol version and capabilities. Server responds with its supported version and capabilities. Client confirms with `initialized` notification.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": { "roots": { "listChanged": true }, "sampling": {} },
    "clientInfo": { "name": "MyClient", "version": "1.0.0" }
  }
}
```

**2. Operation**: Client and server exchange messages according to negotiated capabilities.

**3. Shutdown**: Transport mechanism signals termination. For STDIO, client closes stdin and waits for server exit.

---

## TypeScript implementation with @modelcontextprotocol/sdk

### Project structure

```
my-mcp-server/
├── src/
│   └── index.ts          # Main server entry point
├── build/                # Compiled output
├── package.json
├── tsconfig.json
└── .env                  # Environment variables
```

### package.json configuration

```json
{
  "name": "my-mcp-server",
  "version": "1.0.0",
  "type": "module",
  "bin": { "my-mcp-server": "./build/index.js" },
  "files": ["build"],
  "scripts": {
    "build": "tsc && chmod 755 build/index.js",
    "prepare": "npm run build",
    "inspector": "npx @modelcontextprotocol/inspector build/index.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.22.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/node": "^22",
    "typescript": "^5.3.3"
  }
}
```

**Critical**: Zod is a **required peer dependency** for schema validation. The SDK supports zod v3.25+ and v4.

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./build",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

### Basic server setup

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'my-server',
  version: '1.0.0'
});

// Register a tool
server.registerTool(
  'calculate_bmi',
  {
    title: 'BMI Calculator',
    description: 'Calculate Body Mass Index from weight and height',
    inputSchema: {
      weight_kg: z.number().describe('Weight in kilograms'),
      height_m: z.number().describe('Height in meters')
    },
    outputSchema: { bmi: z.number(), category: z.string() }
  },
  async ({ weight_kg, height_m }) => {
    const bmi = weight_kg / (height_m * height_m);
    const category = bmi < 18.5 ? 'underweight' : bmi < 25 ? 'normal' : 'overweight';
    return {
      content: [{ type: 'text', text: `BMI: ${bmi.toFixed(1)} (${category})` }],
      structuredContent: { bmi, category }
    };
  }
);

// Connect with STDIO transport
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Implementing resources

```typescript
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

// Static resource
server.registerResource(
  'config',
  'config://app',
  { title: 'Application Config', mimeType: 'application/json' },
  async (uri) => ({
    contents: [{ uri: uri.href, text: JSON.stringify({ theme: 'dark' }) }]
  })
);

// Dynamic resource with URI parameters
server.registerResource(
  'user-profile',
  new ResourceTemplate('users://{userId}/profile', { list: undefined }),
  { title: 'User Profile', description: 'Fetch user profile by ID' },
  async (uri, { userId }) => ({
    contents: [{ uri: uri.href, text: `Profile data for ${userId}` }]
  })
);
```

### Error handling pattern

```typescript
async ({ endpoint }) => {
  try {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return {
      content: [{ type: 'text', text: JSON.stringify(data) }],
      structuredContent: { data },
      isError: false
    };
  } catch (error) {
    console.error('Tool error:', error); // Log to stderr
    return {
      isError: true, // Signals failure to LLM
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      structuredContent: { data: null }
    };
  }
}
```

**Critical rule**: Never use `console.log()` for STDIO servers—it pollutes stdout. Use `console.error()` for all logging.

---

## Python implementation with mcp package

### Python version and dependencies

- **Minimum**: Python 3.10
- **Supported**: Python 3.10, 3.11, 3.12, 3.13

### Project structure

```
my-mcp-server/
├── pyproject.toml
├── uv.lock                    # If using uv (recommended)
├── README.md
├── src/
│   └── my_mcp_server/
│       ├── __init__.py
│       ├── server.py          # Main FastMCP server
│       ├── tools.py           # Tool definitions
│       └── resources.py       # Resource definitions
└── tests/
    └── test_server.py
```

### pyproject.toml configuration

```toml
[project]
name = "my-mcp-server"
version = "0.1.0"
description = "MCP Server for specific functionality"
requires-python = ">=3.10"
dependencies = ["mcp[cli]>=1.25.0"]

[project.scripts]
my-mcp-server = "my_mcp_server.server:main"

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/my_mcp_server"]

[tool.uv]
dev-dependencies = ["pyright>=1.1.391", "pytest>=8.3.4", "pytest-asyncio>=0.26.0", "ruff>=0.8.5"]

[tool.ruff]
line-length = 88
target-version = "py310"

[tool.ruff.lint]
select = ["E", "F", "I"]
```

### Basic FastMCP server

```python
"""Main MCP server implementation."""
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("My Server Name")

@mcp.tool()
def calculate_bmi(weight_kg: float, height_m: float) -> float:
    """Calculate Body Mass Index from weight and height."""
    return weight_kg / (height_m ** 2)

@mcp.tool()
async def fetch_weather(city: str) -> str:
    """Fetch current weather for a city."""
    import httpx
    async with httpx.AsyncClient() as client:
        response = await client.get(f"https://api.weather.com/{city}", timeout=30.0)
        response.raise_for_status()
        return response.text

def main():
    """Entry point for the MCP server."""
    mcp.run()

if __name__ == "__main__":
    main()
```

### Lifespan management for database connections

```python
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.session import ServerSession

@dataclass
class AppContext:
    db: Database

@asynccontextmanager
async def app_lifespan(server: FastMCP) -> AsyncIterator[AppContext]:
    db = await Database.connect()
    try:
        yield AppContext(db=db)
    finally:
        await db.disconnect()

mcp = FastMCP("My App", lifespan=app_lifespan)

@mcp.tool()
def query_db(ctx: Context[ServerSession, AppContext]) -> str:
    """Query the database using managed connection."""
    db = ctx.request_context.lifespan_context.db
    return db.query()
```

### Structured output with Pydantic

```python
from pydantic import BaseModel, Field

class WeatherData(BaseModel):
    temperature: float = Field(description="Temperature in Celsius")
    humidity: float = Field(description="Humidity percentage")
    condition: str

@mcp.tool()
def get_weather(city: str) -> WeatherData:
    """Get structured weather data for a city."""
    return WeatherData(temperature=22.5, humidity=45.0, condition="sunny")
```

### Resources and prompts

```python
# Static resource
@mcp.resource("config://settings")
def get_settings() -> str:
    """Get application settings."""
    return '{"theme": "dark", "language": "en"}'

# Dynamic resource with URI template
@mcp.resource("file://documents/{name}")
def read_document(name: str) -> str:
    """Read a document by name."""
    return f"Content of {name}"

# Prompt definition
@mcp.prompt(title="Code Review")
def review_code(code: str, language: str = "python") -> str:
    """Generate a code review prompt."""
    return f"Please review this {language} code:\n\n{code}"
```

---

## Security best practices demand rigorous implementation

### Authentication with OAuth 2.1

MCP mandates **OAuth 2.1** for HTTP-based transports. STDIO servers should retrieve credentials from environment variables instead.

**Key requirements**:
- MCP clients **MUST** implement PKCE with S256 code challenge method
- MCP servers **MUST** validate token audience claims
- All authorization server endpoints **MUST** use HTTPS
- Use RFC 8707 resource indicators to specify intended server

```
Authorization request with resource parameter:
&resource=https%3A%2F%2Fmcp.example.com
```

### Input validation is non-negotiable

**43% of MCP servers** are vulnerable to command injection according to security research. Implement comprehensive validation:

```python
from pydantic import BaseModel, Field, validator
import os

class FileOperationParams(BaseModel):
    path: str = Field(..., min_length=1, max_length=500)
    
    @validator('path')
    def validate_safe_path(cls, v):
        normalized = os.path.normpath(v)
        # Prevent directory traversal
        if '..' in normalized or normalized.startswith('/'):
            raise ValueError('Path cannot contain .. or absolute paths')
        # Block sensitive directories
        forbidden = ['.git', '.env', 'node_modules', '__pycache__']
        if any(pattern in normalized for pattern in forbidden):
            raise ValueError('Access to sensitive directories denied')
        return normalized
```

**Validation requirements**:
- Block path traversal (`../` sequences)
- Escape shell metacharacters (`;`, `|`, backticks)
- Use parameterized queries for database operations
- Strip control characters from output (ASCII 0x1B)
- Use allowlists, not denylists

### Secrets management

**Never hardcode secrets**. Use environment variables injected by the host:

```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│ Claude/LLM  │ -> │  MCP Host    │ -> │ MCP Server  │
│ NEVER sees  │    │ Injects      │    │ SEES the    │
│ secrets     │    │ secrets      │    │ secrets     │
└─────────────┘    └──────────────┘    └─────────────┘
```

**Recommended secrets managers**: HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, 1Password CLI, Doppler.

### Rate limiting implementation

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@app.get("/mcp")
@limiter.limit("100/minute")
def mcp_endpoint():
    return process_request()
```

Implement per-user, per-domain, and global limits with adaptive throttling based on server load.

### Transport security

- All production systems **MUST** use TLS (HTTPS)
- Disable TLS 1.0/1.1; use TLS 1.2 minimum, TLS 1.3 recommended
- Validate Origin headers on HTTP requests
- Bind to `127.0.0.1` for local deployments (never `0.0.0.0` without authentication)

---

## Architecture patterns for different deployment scenarios

### Pattern 1: Standalone local (STDIO)

```
┌────────────────┐       STDIO        ┌─────────────────┐
│  MCP Client    │◄──────────────────►│   Local MCP     │
│ (Claude/IDE)   │                    │     Server      │
└────────────────┘                    └─────────────────┘
```

**Configuration (Claude Desktop)**:
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["@modelcontextprotocol/server-filesystem", "/path/to/files"]
    }
  }
}
```

**Best for**: Local file access, development tools, CLI integrations.

### Pattern 2: Remote deployment (Streamable HTTP)

```
┌────────────────┐      HTTPS         ┌─────────────────┐
│  MCP Client    │◄──────────────────►│   Remote MCP    │
│                │   + OAuth 2.1      │     Server      │
└────────────────┘                    └─────────────────┘
```

**Best for**: SaaS integrations, team-shared tools, cloud deployments.

### Pattern 3: Enterprise gateway

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Gateway Layer                     │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐       │
│  │ Auth/OAuth  │ │ Rate Limit  │ │ Observability│       │
│  └─────────────┘ └─────────────┘ └─────────────┘       │
└─────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ MCP Server A │    │ MCP Server B │    │ MCP Server C │
└──────────────┘    └──────────────┘    └──────────────┘
```

**Gateway capabilities**: Virtual servers (role-based tool collections), unified authentication, centralized logging, WAF protection, approval workflows.

### Docker containerization

```dockerfile
FROM python:3.11-slim
WORKDIR /app

RUN pip install --no-cache-dir mcp>=1.25.0 uvicorn starlette

COPY server.py .

EXPOSE 8080
ENV MCP_TRANSPORT=sse
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8080

CMD ["python", "server.py"]
```

### Kubernetes deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-server
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: mcp-server
        image: your-registry/mcp-server:v1
        ports:
        - containerPort: 8080
        resources:
          requests: { memory: "256Mi", cpu: "250m" }
          limits: { memory: "512Mi", cpu: "500m" }
        livenessProbe:
          httpGet: { path: /health, port: 8080 }
          initialDelaySeconds: 30
        readinessProbe:
          httpGet: { path: /ready, port: 8080 }
          initialDelaySeconds: 5
```

---

## Error handling follows JSON-RPC 2.0 conventions

### Standard error codes

| Code | Name | Description |
|------|------|-------------|
| `-32700` | Parse Error | Invalid JSON syntax |
| `-32600` | Invalid Request | Message structure violates protocol |
| `-32601` | Method Not Found | Requested method doesn't exist |
| `-32602` | Invalid Params | Parameter validation failed |
| `-32603` | Internal Error | Server implementation issue |
| `-32001` | Timeout | Request timed out |
| `-32002` | Resource Not Found | Requested resource unavailable |

### Tool execution errors use isError flag

Tools return successful responses with `isError: true` rather than JSON-RPC errors:

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [{"type": "text", "text": "Failed to fetch: API key invalid"}],
    "isError": true
  }
}
```

### Retry with exponential backoff

```python
async def fetch_with_retry(url: str, max_retries: int = 3) -> dict:
    for attempt in range(max_retries):
        try:
            response = await client.get(url)
            response.raise_for_status()
            return response.json()
        except httpx.TimeoutException:
            if attempt == max_retries - 1:
                raise
            wait_time = 2 ** attempt  # Exponential backoff
            await asyncio.sleep(wait_time)
        except httpx.HTTPStatusError as e:
            if e.response.status_code >= 500 and attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)
                continue
            raise
```

### Structured logging

```python
import structlog
from prometheus_client import Counter, Histogram

REQUEST_COUNT = Counter('mcp_requests_total', 'Total requests', ['method', 'status'])
REQUEST_DURATION = Histogram('mcp_request_duration_seconds', 'Request duration')

logger = structlog.get_logger()

@REQUEST_DURATION.time()
def handle_request(request):
    try:
        result = process_request(request)
        REQUEST_COUNT.labels(method=request.method, status='success').inc()
        logger.info("request_processed", method=request.method, duration=duration)
        return result
    except Exception as e:
        REQUEST_COUNT.labels(method=request.method, status='error').inc()
        logger.error("request_failed", method=request.method, error=str(e))
        raise
```

---

## Testing strategies ensure reliability

### Unit testing with FastMCP Client

```python
import pytest
from fastmcp import FastMCP, Client

async def test_tool_execution():
    server = FastMCP("TestServer")
    
    @server.tool
    def add(x: int, y: int) -> int:
        return x + y
    
    async with Client(server) as client:
        result = await client.call_tool("add", {"x": 5, "y": 3})
        assert result[0].text == "8"
```

### Parametrized testing

```python
@pytest.fixture
async def mcp_client():
    async with Client(mcp) as client:
        yield client

@pytest.mark.parametrize("a,b,expected", [(1, 2, 3), (2, 3, 5), (0, 0, 0)])
async def test_add(a: int, b: int, expected: int, mcp_client: Client):
    result = await mcp_client.call_tool("add", {"x": a, "y": b})
    assert result.data == expected
```

### Integration testing

```python
class TestMCPIntegration:
    def setUp(self):
        self.test_db = TestDatabase()
        self.server = MCPServer(database=self.test_db)
    
    def test_database_query_flow(self):
        result = self.server.execute_query("SELECT * FROM users")
        assert len(result) == 3
    
    def test_concurrent_requests(self):
        with ThreadPoolExecutor(max_workers=50) as executor:
            futures = [executor.submit(self.make_request) for _ in range(1000)]
            results = [f.result() for f in futures]
            success_rate = sum(1 for r in results if r.success) / len(results)
            assert success_rate > 0.99
```

### CI/CD pipeline

```yaml
name: MCP Server CI/CD
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
          cache: 'npm'
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run test:integration
      - run: npm run build

  deploy:
    needs: test
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - name: Deploy to production
        run: echo "Deploying MCP server..."
```

---

## Documentation standards for LLM consumption

### Writing effective tool descriptions

Tool descriptions are consumed by LLMs, not humans. Write them to help agents understand when and how to use each tool:

```typescript
{
  title: "Search Users",
  description: `Search for users by name, email, or other criteria.
  Use this tool when you need to find specific users or list users matching a pattern.
  Returns user records with ID, name, email, and status.
  
  Example: Search for "john" to find all users with "john" in their name or email.`,
  inputSchema: {
    query: z.string()
      .min(2, "Query must be at least 2 characters")
      .describe("Search string to match against names/emails"),
    limit: z.number()
      .int().min(1).max(100).default(20)
      .describe("Maximum results to return")
  }
}
```

**Key principles**:
- Be explicit about what the tool does and when to use it
- Document expected outcomes and return formats
- Write error messages for agents: "To have access, configure API_TOKEN" not "Access denied"
- Note side effects (state modification, external interactions)

### README template

```markdown
# [Server Name] MCP Server

Brief description of functionality.

## Features
- Feature 1
- Feature 2

## Installation

### Prerequisites
- Node.js 18+ / Python 3.10+

### Install
```bash
npm install @your-org/your-server
```

## Configuration

### Environment Variables
| Variable | Description | Required |
|----------|-------------|----------|
| API_KEY | Your API key | Yes |

### Claude Desktop Configuration
```json
{
  "mcpServers": {
    "your-server": {
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": { "API_KEY": "your-key" }
    }
  }
}
```

## Available Tools

### tool_name
Description of tool functionality.

**Parameters:**
- `param1` (string, required): Description
- `param2` (number, optional): Description

## Security Considerations
- Required permissions
- Rate limiting

## License
MIT
```

---

## Performance optimization techniques

### Connection pooling

```python
class PerformantMCPServer:
    def __init__(self):
        self.db_pool = ConnectionPool(
            min_connections=5,
            max_connections=20,
            connection_timeout=30
        )
```

### Multi-level caching

```python
self.cache = MultiLevelCache([
    InMemoryCache(max_size=1000, ttl=60),   # L1: Fast, small
    RedisCache(ttl=3600),                   # L2: Shared, persistent
])
```

**What to cache**: `resources/list`, `resources/read`, `prompts/list`, `tools/list`.
**What NOT to cache**: `tools/call` (dynamic), initialization, capability negotiation.

### Async patterns

```python
@mcp.tool()
async def concurrent_fetch(urls: list[str]) -> list[str]:
    """Fetch multiple URLs concurrently."""
    async with httpx.AsyncClient() as client:
        tasks = [client.get(url) for url in urls]
        responses = await asyncio.gather(*tasks)
        return [r.text for r in responses]
```

**Critical rules**:
- Use `async def` for I/O-bound tool handlers
- Use `await asyncio.sleep()` not `time.sleep()`
- Run CPU-intensive tasks in thread pools
- Only write JSON-RPC messages to stdout; logs go to stderr

### Performance targets

| Metric | Target |
|--------|--------|
| Throughput | >1000 requests/second per instance |
| Latency P95 | <100ms for simple operations |
| Latency P99 | <500ms for complex operations |
| Error Rate | <0.1% under normal conditions |
| Availability | >99.9% uptime |

---

## Versioning and compatibility

### Protocol versioning

MCP uses date-based versioning (`YYYY-MM-DD`). Current version: **2025-06-18**.

Version negotiation occurs during initialization:
1. Client sends supported protocol version
2. Server responds with same version if supported, otherwise its latest
3. Client disconnects if it can't support server's version

### Server versioning

Use Semantic Versioning (MAJOR.MINOR.PATCH):
- **MAJOR**: Breaking API changes (removed tools, changed schemas)
- **MINOR**: New backward-compatible features (new tools, optional parameters)
- **PATCH**: Bug fixes

```json
{
  "serverInfo": {
    "name": "my-mcp-server",
    "version": "1.2.3"
  }
}
```

### Backward compatibility

- Never remove existing tools without a deprecation period
- Add new parameters with sensible defaults
- Create versioned tool names for breaking changes (`search_v2`)
- Document compatibility matrix in README

---

## Common anti-patterns to avoid

| Anti-Pattern | Problem | Solution |
|--------------|---------|----------|
| **Monolithic server** | Too many tools, poor separation | Single responsibility per server |
| **Tool overload** | Exposing every API as a tool | Use prompts to chain operations |
| **Human error messages** | LLM can't act on "Access denied" | Provide actionable guidance |
| **console.log to stdout** | Breaks JSON-RPC protocol | Use `console.error()` |
| **Synchronous I/O** | Causes timeouts | Use `async/await` |
| **Building mini-LLMs** | Server tries to analyze/reason | Be an information provider |
| **Token passthrough** | Security risk | Validate audience claims |
| **Hardcoded secrets** | Security vulnerability | Use environment variables |

---

## Reference implementations

### Official Anthropic servers

| Server | Purpose | Repository |
|--------|---------|------------|
| Everything | Test server with all features | `modelcontextprotocol/servers/src/everything` |
| Fetch | Web content fetching | `modelcontextprotocol/servers/src/fetch` |
| Filesystem | Secure file operations | `modelcontextprotocol/servers/src/filesystem` |
| Git | Repository operations | `modelcontextprotocol/servers/src/git` |
| Memory | Knowledge graph | `modelcontextprotocol/servers/src/memory` |

### Official SDKs

| Language | Repository |
|----------|------------|
| TypeScript | github.com/modelcontextprotocol/typescript-sdk |
| Python | github.com/modelcontextprotocol/python-sdk |
| Java | github.com/modelcontextprotocol/java-sdk |
| Go | github.com/modelcontextprotocol/go-sdk |
| Rust | github.com/modelcontextprotocol/rust-sdk |

### Key documentation

- **Specification**: modelcontextprotocol.io/specification/2025-06-18
- **Best Practices**: modelcontextprotocol.info/docs/best-practices
- **MCP Inspector**: modelcontextprotocol.io/docs/tools/inspector

---

## Quick reference checklist

### Before deployment

- [ ] All tools have descriptive docstrings/descriptions
- [ ] Input schemas validate all parameters
- [ ] Path traversal and injection attacks prevented
- [ ] Secrets loaded from environment variables
- [ ] Rate limiting implemented
- [ ] Error responses use `isError: true` for tool failures
- [ ] Logging goes to stderr, not stdout
- [ ] Unit and integration tests pass
- [ ] README documents all tools, resources, and configuration

### Security checklist

- [ ] OAuth 2.1 implemented for HTTP transports
- [ ] Token audience claims validated
- [ ] PKCE with S256 used for authorization
- [ ] HTTPS enforced for all production endpoints
- [ ] Input sanitization prevents command injection
- [ ] Sensitive directories blocked from file access
- [ ] Secrets stored in approved secrets manager

### Production readiness

- [ ] Health check endpoint implemented
- [ ] Structured logging with correlation IDs
- [ ] Metrics exposed (Prometheus format)
- [ ] Graceful shutdown handles in-flight requests
- [ ] Connection pooling for database/HTTP clients
- [ ] Retry logic with exponential backoff
- [ ] Circuit breakers for external dependencies