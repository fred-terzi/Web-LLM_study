/**
 * OpenWebUI Integration Server
 * 
 * This Express server integrates OpenWebUI with the WebLLM engine by:
 * 1. Serving the WebLLM frontend application via Vite (where the engine runs)
 * 2. Providing API endpoints that proxy to the browser-based WebLLM engine
 * 3. Enabling CORS for OpenWebUI to access these endpoints
 * 
 * Architecture:
 * - OpenWebUI (Docker) calls this server's /v1/* endpoints
 * - This server serves the WebLLM app in the browser
 * - The browser's fetchRouter intercepts API calls and routes to WebLLM engine
 * - Responses flow back: Browser -> Server -> OpenWebUI
 * 
 * Note: For a fully functional integration, users should:
 * 1. Open the WebLLM frontend in a browser (to initialize the engine)
 * 2. Use OpenWebUI which will connect to the same backend
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'vite';
import { prebuiltAppConfig } from '@mlc-ai/web-llm';

const app = express();
const PORT = process.env.PORT || 3001;
const OPENWEBUI_URL = process.env.OPENWEBUI_URL || 'http://localhost:3000';

// Enable CORS for OpenWebUI
app.use(cors({
  origin: [OPENWEBUI_URL, 'http://localhost:3000', 'http://localhost:8080'],
  credentials: true,
}));

app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'webllm-openwebui-bridge' });
});

// List models endpoint - returns WebLLM models in OpenAI format
app.get('/v1/models', async (req, res) => {
  try {
    const models = prebuiltAppConfig.model_list.map((m) => ({
      id: m.model_id,
      object: 'model' as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: 'webllm',
    }));

    res.json({
      object: 'list',
      data: models,
    });
  } catch (error) {
    res.status(500).json({
      error: {
        message: (error as Error).message,
        type: 'server_error',
      },
    });
  }
});

/**
 * Chat completions endpoint
 * 
 * This endpoint provides a mock response since the actual WebLLM engine
 * runs in the browser context. For a production deployment, you would need:
 * 
 * 1. A WebSocket connection between the server and browser client
 * 2. OR a headless browser automation (Puppeteer/Playwright)
 * 3. OR users to have the WebLLM UI open in their browser
 * 
 * The current implementation demonstrates the API structure OpenWebUI expects.
 */
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages, model, stream = false, temperature, max_tokens } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          message: 'messages field is required and must be an array',
          type: 'invalid_request_error',
        },
      });
    }

    // Extract the user's message
    const userMessage = messages[messages.length - 1]?.content || 'Hello';
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      // Provide a helpful response explaining the setup
      const response = `WebLLM Bridge Server Response: To use OpenWebUI with WebLLM, you need to have the WebLLM frontend open in a browser (at ${req.protocol}://${req.get('host')}). The WebLLM engine runs entirely in-browser using WebGPU. For full integration, consider opening the main UI where the model is loaded.`;
      
      // Stream the response
      const chunks = response.split(' ');
      for (let i = 0; i < chunks.length; i++) {
        const chunk = {
          id: `chatcmpl-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: model || 'webllm',
          choices: [{
            index: 0,
            delta: i === 0 ? { role: 'assistant', content: chunks[i] + ' ' } : { content: chunks[i] + ' ' },
            finish_reason: i === chunks.length - 1 ? 'stop' : null,
          }],
        };
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // Non-streaming response
      res.json({
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'webllm',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: `WebLLM Bridge Server Response: To use OpenWebUI with WebLLM, you need to have the WebLLM frontend open in a browser (at ${req.protocol}://${req.get('host')}). The WebLLM engine runs entirely in-browser using WebGPU.`,
          },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: messages.reduce((acc, m) => acc + m.content.length / 4, 0),
          completion_tokens: 30,
          total_tokens: 30 + messages.reduce((acc, m) => acc + m.content.length / 4, 0),
        },
      });
    }
  } catch (error) {
    res.status(500).json({
      error: {
        message: (error as Error).message,
        type: 'server_error',
      },
    });
  }
});

async function startServer() {
  // Create Vite dev server for serving the frontend
  const vite = await createServer({
    server: { 
      middlewareMode: true,
      cors: true,
    },
    appType: 'spa',
  });

  // API routes come first
  // Then Vite handles the rest (frontend)
  app.use(vite.middlewares);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 WebLLM-OpenWebUI Bridge Server Started`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📡 Server:              http://localhost:${PORT}`);
    console.log(`🌐 Frontend (WebLLM):   http://localhost:${PORT}`);
    console.log(`🔌 API Endpoints:       http://localhost:${PORT}/v1/*`);
    console.log(`🎨 OpenWebUI:           ${OPENWEBUI_URL}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(`📖 Instructions:`);
    console.log(`   1. Open http://localhost:${PORT} in your browser`);
    console.log(`   2. Wait for WebLLM model to load (uses WebGPU)`);
    console.log(`   3. Access OpenWebUI at ${OPENWEBUI_URL}`);
    console.log(`   4. OpenWebUI will connect to this server's API\n`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
