import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import QuickView from './QuickView';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{(window as Window & { __METERLUMA_QUICK__?: boolean }).__METERLUMA_QUICK__ || new URLSearchParams(window.location.search).get('view') === 'quick' ? <QuickView/> : <App />}</React.StrictMode>,
);
