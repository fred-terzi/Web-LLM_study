# OpenWebUI Integration with WebLLM Engine

This directory contains the integration between OpenWebUI and the WebLLM engine, allowing you to use OpenWebUI's modern chat interface with WebLLM's browser-based AI models.

## Architecture

```
┌─────────────┐     HTTP      ┌──────────────────┐     WebLLM      ┌─────────────┐
│  OpenWebUI  │ ───────────>  │  Bridge Server   │ ─────────────>  │  Browser    │
│  (Docker)   │               │  (Node.js/Vite)  │                 │  WebGPU     │
└─────────────┘               └──────────────────┘                 └─────────────┘
  Port 3000                        Port 3001                         In-Browser
```

## Components

### 1. OpenWebUI (Docker Container)
- Modern, feature-rich chat UI
- Runs in Docker container on port 3000
- Connects to the bridge server via OpenAI-compatible API

### 2. Bridge Server (openwebui-server.ts)
- Express.js server that provides OpenAI-compatible API endpoints
- Serves the WebLLM frontend application via Vite
- Routes API calls from OpenWebUI to the WebLLM engine
- Runs on port 3001

### 3. WebLLM Engine (Browser)
- Runs entirely in the browser using WebGPU
- No data leaves your device
- Accessible via the Vite dev server

## Quick Start

### Prerequisites
- Docker and Docker Compose installed
- Node.js 18+ installed
- A browser with WebGPU support (Chrome 113+ or Edge 113+)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Start the OpenWebUI container:
```bash
npm run openwebui:up
```

3. In a separate terminal, start the bridge server:
```bash
npm run dev:openwebui
```

4. Open your browser and navigate to:
   - OpenWebUI: http://localhost:3000
   - WebLLM Frontend (original UI): http://localhost:3001

### Usage

1. In OpenWebUI (http://localhost:3000):
   - The interface will automatically connect to the WebLLM engine
   - Select a model from the dropdown (e.g., SmolLM2-360M-Instruct-q4f32_1-MLC)
   - Start chatting!

2. The first time you use a model, it will download and cache in your browser (1-2 GB)

### Stopping

Stop the OpenWebUI container:
```bash
npm run openwebui:down
```

Stop the bridge server:
Press `Ctrl+C` in the terminal running `dev:openwebui`

## Configuration

### Environment Variables

You can configure the bridge server using environment variables:

- `PORT`: Server port (default: 3001)
- `OPENWEBUI_URL`: OpenWebUI URL (default: http://localhost:3000)

### Docker Compose

The `docker-compose.openwebui.yml` file configures:
- OpenWebUI image and version
- Port mappings
- Environment variables for OpenAI API connection
- Volume for persistent data

## Testing

Run integration tests:
```bash
npm run test:openwebui
```

## Troubleshooting

### OpenWebUI can't connect to API
- Ensure the bridge server is running on port 3001
- Check Docker logs: `npm run openwebui:logs`
- Verify `host.docker.internal` resolves correctly in your Docker setup

### WebGPU not available
- Use Chrome 113+ or Edge 113+
- Enable WebGPU in browser flags if needed
- Check GPU compatibility

### Models not loading
- First load requires downloading ~1-2GB
- Check browser console for errors
- Ensure sufficient GPU memory (VRAM)

## Development

### Project Structure

```
.
├── openwebui-server.ts          # Bridge server
├── docker-compose.openwebui.yml # Docker setup
├── tests/openwebui.test.ts      # Integration tests
└── OPENWEBUI.md                 # This file
```

### Making Changes

1. Modify `openwebui-server.ts` for API changes
2. Restart the bridge server
3. Run tests to verify: `npm run test:openwebui`

## Architecture Details

### API Endpoints

The bridge server provides OpenAI-compatible endpoints:

- `GET /v1/models` - List available WebLLM models
- `POST /v1/chat/completions` - Chat completion (streaming and non-streaming)
- `GET /health` - Health check

### Communication Flow

1. User types message in OpenWebUI
2. OpenWebUI sends POST to `/v1/chat/completions`
3. Bridge server receives request
4. Bridge server communicates with WebLLM engine (in browser context)
5. Response streams back to OpenWebUI
6. OpenWebUI displays the response

## Limitations

- WebLLM runs in the browser, so it requires an active browser session
- First model load downloads 1-2GB of data
- Performance depends on GPU availability and power
- Currently supports single-user usage

## Future Improvements

- [ ] WebSocket support for better real-time communication
- [ ] Multi-user support with session management
- [ ] Model caching optimization
- [ ] Better error handling and recovery
- [ ] Metrics and monitoring

## Contributing

See the main README for contribution guidelines.

## License

Same as the parent project.
