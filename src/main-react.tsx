/**
 * Main entry point for React-based WebLLM chat application
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatApp } from './ChatApp';

// Mount React app
const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ChatApp />
    </React.StrictMode>
  );
}
