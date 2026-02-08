/**
 * OpenWebUI Integration Server
 * 
 * This Express server acts as a bridge between OpenWebUI and the WebLLM engine.
 * It provides HTTP endpoints that OpenWebUI can call, which then route to the
 * WebLLM engine running in the browser via the existing fetchRouter.
 * 
 * The server serves the frontend application and provides API endpoints
 * compatible with OpenAI's API format that OpenWebUI expects.
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'vite';

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

// OpenAI-compatible API endpoints
// These will be proxied to the WebLLM engine running in the browser

// List models endpoint
app.get('/v1/models', async (req, res) => {
  try {
    // Return a static list of available WebLLM models
    // In production, this would query the actual engine
    res.json({
      object: 'list',
      data: [
        {
          id: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
          object: 'model',
          created: Date.now() / 1000,
          owned_by: 'webllm',
        },
        {
          id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
          object: 'model',
          created: Date.now() / 1000,
          owned_by: 'webllm',
        },
        {
          id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
          object: 'model',
          created: Date.now() / 1000,
          owned_by: 'webllm',
        },
      ],
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

// Chat completions endpoint - main endpoint for OpenWebUI
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

    // For now, return a placeholder response
    // In a full implementation, this would interface with the WebLLM engine
    // through a WebSocket or other mechanism
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const response = "This is a streaming response from WebLLM. In production, this would connect to the actual WebLLM engine running in a browser context.";
      
      // Send chunks
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
            content: 'This is a response from WebLLM. In production, this would connect to the actual WebLLM engine running in a browser context.',
          },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
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
    server: { middlewareMode: true },
    appType: 'spa',
  });

  // Use Vite's middleware
  app.use(vite.middlewares);

  app.listen(PORT, () => {
    console.log(`WebLLM-OpenWebUI bridge server running on http://localhost:${PORT}`);
    console.log(`API endpoints available at http://localhost:${PORT}/v1/*`);
    console.log(`Frontend available at http://localhost:${PORT}`);
    console.log(`Configured for OpenWebUI at ${OPENWEBUI_URL}`);
  });
}

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
