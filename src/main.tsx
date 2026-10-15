import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import QuickView from './QuickView';
import './styles.css';
import { readSettings } from './model';

// Resolve the saved preference before rendering either window.
const initialTheme = readSettings().theme;
document.documentElement.dataset.theme = initialTheme === 'system'
  ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  : initialTheme;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{(window as Window & { __METERLUMA_QUICK__?: boolean }).__METERLUMA_QUICK__ || new URLSearchParams(window.location.search).get('view') === 'quick' ? <QuickView/> : <App />}</React.StrictMode>,
);
