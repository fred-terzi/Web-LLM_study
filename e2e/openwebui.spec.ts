/**
 * End-to-End OpenWebUI Integration Tests
 * 
 * These tests verify the OpenWebUI integration with the WebLLM bridge server.
 * Tests include actual HTTP requests to the bridge server endpoints.
 */

import { test, expect } from '@playwright/test';

const BRIDGE_SERVER_URL = process.env.BRIDGE_SERVER_URL || 'http://127.0.0.1:3001';

test.describe('OpenWebUI Bridge Server E2E', () => {
  test('health check endpoint should return OK', async ({ request }) => {
    const response = await request.get(`${BRIDGE_SERVER_URL}/health`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('status', 'ok');
    expect(data).toHaveProperty('service', 'webllm-openwebui-bridge');
  });

  test('models endpoint should return WebLLM models', async ({ request }) => {
    const response = await request.get(`${BRIDGE_SERVER_URL}/v1/models`);
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('object', 'list');
    expect(data).toHaveProperty('data');
    expect(Array.isArray(data.data)).toBeTruthy();
    expect(data.data.length).toBeGreaterThan(0);
    
    // Check first model has required fields
    const firstModel = data.data[0];
    expect(firstModel).toHaveProperty('id');
    expect(firstModel).toHaveProperty('object', 'model');
    expect(firstModel).toHaveProperty('owned_by', 'webllm');
  });

  test('chat completions endpoint should accept valid requests', async ({ request }) => {
    const response = await request.post(`${BRIDGE_SERVER_URL}/v1/chat/completions`, {
      data: {
        messages: [
          { role: 'user', content: 'Hello, how are you?' }
        ],
        model: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
        stream: false,
      },
    });
    
    expect(response.ok()).toBeTruthy();
    
    const data = await response.json();
    expect(data).toHaveProperty('id');
    expect(data).toHaveProperty('object', 'chat.completion');
    expect(data).toHaveProperty('choices');
    expect(Array.isArray(data.choices)).toBeTruthy();
    expect(data.choices[0]).toHaveProperty('message');
    expect(data.choices[0].message).toHaveProperty('role', 'assistant');
    expect(data.choices[0].message).toHaveProperty('content');
  });

  test('chat completions should reject invalid requests', async ({ request }) => {
    const response = await request.post(`${BRIDGE_SERVER_URL}/v1/chat/completions`, {
      data: {
        // Missing required 'messages' field
        model: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
      },
    });
    
    expect(response.status()).toBe(400);
    
    const data = await response.json();
    expect(data).toHaveProperty('error');
    expect(data.error).toHaveProperty('message');
  });

  test('streaming chat completions should work', async ({ request }) => {
    const response = await request.post(`${BRIDGE_SERVER_URL}/v1/chat/completions`, {
      data: {
        messages: [
          { role: 'user', content: 'Hello!' }
        ],
        model: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
        stream: true,
      },
    });
    
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['content-type']).toContain('text/event-stream');
    
    // Read a bit of the stream to verify it's working
    const body = await response.text();
    expect(body).toContain('data: ');
    expect(body).toMatch(/chat\.completion\.chunk/);
  });

  test('CORS headers should be present for API requests', async ({ request }) => {
    const response = await request.get(`${BRIDGE_SERVER_URL}/v1/models`, {
      headers: {
        'Origin': 'http://localhost:3000',
      },
    });
    
    expect(response.ok()).toBeTruthy();
    
    // Check for CORS headers
    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBeDefined();
  });
});

test.describe('OpenWebUI Docker Integration', () => {
  test('docker-compose file should be valid', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const dockerComposePath = path.join(process.cwd(), 'docker-compose.openwebui.yml');
    const content = await fs.readFile(dockerComposePath, 'utf-8');
    
    // Basic YAML structure checks
    expect(content).toContain('version:');
    expect(content).toContain('services:');
    expect(content).toContain('openwebui:');
    expect(content).toContain('image: ghcr.io/open-webui/open-webui');
    
    // Check environment configuration
    expect(content).toContain('OPENAI_API_BASE_URL');
    expect(content).toContain('host.docker.internal:3001');
  });

  test('documentation should exist and be complete', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const docPath = path.join(process.cwd(), 'OPENWEBUI.md');
    const content = await fs.readFile(docPath, 'utf-8');
    
    // Check for essential documentation sections
    expect(content).toContain('Architecture');
    expect(content).toContain('Quick Start');
    expect(content).toContain('Installation');
    expect(content).toContain('Usage');
    expect(content).toContain('Troubleshooting');
    
    // Check for essential commands
    expect(content).toContain('npm install');
    expect(content).toContain('npm run openwebui:up');
    expect(content).toContain('npm run dev:openwebui');
  });
});
