import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyAppearance, loadAppearance } from './ui/appearance';
import './styles.css';

// 首帧之前就把字号/行高写进 CSS 变量，避免打开时先闪一下默认大小
applyAppearance(loadAppearance());

const el = document.getElementById('root');
if (!el) throw new Error('#root not found');

createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
