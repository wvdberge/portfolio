import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

// Apply the saved theme before the first render, so the page doesn't flash dark
try { if (localStorage.getItem('theme') === 'light') document.documentElement.dataset.theme = 'light'; } catch { /* dark */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
