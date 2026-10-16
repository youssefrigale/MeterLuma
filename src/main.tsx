import React from 'react';
import ReactDOM from 'react-dom/client';
import QuickView from './QuickView';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';
import { readSettings } from './model';

// Resolve the saved preference before the first render.
const initialTheme = readSettings().theme;
document.documentElement.dataset.theme = initialTheme === 'system'
  ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  : initialTheme;

// MeterLuma is a tray app: the panel is its only window.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><QuickView/></ErrorBoundary></React.StrictMode>,
);
