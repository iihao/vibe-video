import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './theme.css';

// three.js 只用于星云 WebGL 层：异步加载，主包保持轻量。
import('../shared/nebula-webgl.mjs').then(({ registerNebula }) => registerNebula()).catch(() => {});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
