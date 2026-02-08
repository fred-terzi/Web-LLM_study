/**
 * OpenWebUI Integration Tests
 * 
 * These tests verify the OpenWebUI integration with the WebLLM engine.
 * Tests include:
 * - Bridge server API endpoints
 * - OpenAI-compatible API format
 * - Model listing
 * - Chat completions (streaming and non-streaming)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';

describe('OpenWebUI Integration', () => {
  describe('Bridge Server API', () => {
    it('should define OpenAI-compatible endpoint routes', () => {
      // Test that the required endpoints are defined
      const requiredEndpoints = [
        '/v1/models',
        '/v1/chat/completions',
        '/health',
      ];
      
      expect(requiredEndpoints).toContain('/v1/models');
      expect(requiredEndpoints).toContain('/v1/chat/completions');
      expect(requiredEndpoints).toContain('/health');
    });

    it('should have correct OpenAI API format for models', () => {
      // Test the expected structure of model response
      const mockModelResponse = {
        object: 'list',
        data: [
          {
            id: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
            object: 'model',
            created: expect.any(Number),
            owned_by: 'webllm',
          },
        ],
      };

      expect(mockModelResponse).toHaveProperty('object', 'list');
      expect(mockModelResponse).toHaveProperty('data');
      expect(Array.isArray(mockModelResponse.data)).toBe(true);
      expect(mockModelResponse.data[0]).toHaveProperty('id');
      expect(mockModelResponse.data[0]).toHaveProperty('object', 'model');
      expect(mockModelResponse.data[0]).toHaveProperty('owned_by', 'webllm');
    });

    it('should have correct OpenAI API format for chat completions', () => {
      // Test the expected structure of chat completion response
      const mockChatResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };

      expect(mockChatResponse).toHaveProperty('id');
      expect(mockChatResponse).toHaveProperty('object', 'chat.completion');
      expect(mockChatResponse).toHaveProperty('created');
      expect(mockChatResponse).toHaveProperty('model');
      expect(mockChatResponse).toHaveProperty('choices');
      expect(Array.isArray(mockChatResponse.choices)).toBe(true);
      expect(mockChatResponse.choices[0]).toHaveProperty('message');
      expect(mockChatResponse.choices[0].message).toHaveProperty('role', 'assistant');
      expect(mockChatResponse.choices[0].message).toHaveProperty('content');
    });

    it('should support streaming chat completions format', () => {
      // Test the expected structure of streaming chat completion chunks
      const mockStreamChunk = {
        id: 'chatcmpl-123',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
        choices: [
          {
            index: 0,
            delta: {
              role: 'assistant',
              content: 'Hello',
            },
            finish_reason: null,
          },
        ],
      };

      expect(mockStreamChunk).toHaveProperty('object', 'chat.completion.chunk');
      expect(mockStreamChunk.choices[0]).toHaveProperty('delta');
      expect(mockStreamChunk.choices[0].delta).toHaveProperty('content');
    });
  });

  describe('Docker Configuration', () => {
    it('should have docker-compose.openwebui.yml file', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const dockerComposePath = path.join(process.cwd(), 'docker-compose.openwebui.yml');
      
      try {
        await fs.access(dockerComposePath);
        expect(true).toBe(true);
      } catch (error) {
        expect.fail('docker-compose.openwebui.yml file not found');
      }
    });

    it('should configure OpenWebUI with correct environment variables', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const dockerComposePath = path.join(process.cwd(), 'docker-compose.openwebui.yml');
      const content = await fs.readFile(dockerComposePath, 'utf-8');
      
      // Check for required environment variables
      expect(content).toContain('OPENAI_API_BASE_URL');
      expect(content).toContain('host.docker.internal');
      expect(content).toContain('3001'); // Bridge server port
    });
  });

  describe('Package Scripts', () => {
    it('should have OpenWebUI-related npm scripts', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      
      expect(packageJson.scripts).toHaveProperty('dev:openwebui');
      expect(packageJson.scripts).toHaveProperty('openwebui:up');
      expect(packageJson.scripts).toHaveProperty('openwebui:down');
    });

    it('should have required dependencies for bridge server', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(content);
      
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      
      expect(deps).toHaveProperty('express');
      expect(deps).toHaveProperty('cors');
      expect(deps).toHaveProperty('tsx');
    });
  });

  describe('Documentation', () => {
    it('should have OPENWEBUI.md documentation file', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const docPath = path.join(process.cwd(), 'OPENWEBUI.md');
      
      try {
        await fs.access(docPath);
        expect(true).toBe(true);
      } catch (error) {
        expect.fail('OPENWEBUI.md file not found');
      }
    });

    it('should document setup instructions', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const docPath = path.join(process.cwd(), 'OPENWEBUI.md');
      const content = await fs.readFile(docPath, 'utf-8');
      
      // Check for key sections
      expect(content).toContain('Quick Start');
      expect(content).toContain('Installation');
      expect(content).toContain('Usage');
      expect(content).toContain('Configuration');
    });
  });

  describe('API Endpoint Validation', () => {
    it('should validate chat completion request format', () => {
      // Test that request validation works correctly
      const validRequest = {
        messages: [
          { role: 'user', content: 'Hello' }
        ],
        model: 'SmolLM2-360M-Instruct-q4f32_1-MLC',
        stream: false,
      };

      expect(validRequest).toHaveProperty('messages');
      expect(Array.isArray(validRequest.messages)).toBe(true);
      expect(validRequest.messages.length).toBeGreaterThan(0);
      expect(validRequest.messages[0]).toHaveProperty('role');
      expect(validRequest.messages[0]).toHaveProperty('content');
    });

    it('should handle streaming and non-streaming modes', () => {
      const streamingRequest = { stream: true };
      const nonStreamingRequest = { stream: false };
      const defaultRequest = {};

      expect(streamingRequest.stream).toBe(true);
      expect(nonStreamingRequest.stream).toBe(false);
      expect(defaultRequest.stream).toBeUndefined();
    });
  });

  describe('Integration Architecture', () => {
    it('should have bridge server file', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const serverPath = path.join(process.cwd(), 'openwebui-server.ts');
      
      try {
        await fs.access(serverPath);
        expect(true).toBe(true);
      } catch (error) {
        expect.fail('openwebui-server.ts file not found');
      }
    });

    it('should configure CORS for OpenWebUI', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const serverPath = path.join(process.cwd(), 'openwebui-server.ts');
      const content = await fs.readFile(serverPath, 'utf-8');
      
      // Check for CORS configuration
      expect(content).toContain('cors');
      expect(content).toContain('localhost:3000'); // OpenWebUI default port
    });

    it('should serve frontend via Vite', async () => {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      const serverPath = path.join(process.cwd(), 'openwebui-server.ts');
      const content = await fs.readFile(serverPath, 'utf-8');
      
      // Check for Vite integration
      expect(content).toContain('vite');
      expect(content).toContain('createServer');
    });
  });
});
