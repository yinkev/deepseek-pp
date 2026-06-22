import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { I18nProvider } from './i18n';
import './style.css';

type DeepSeekTheme = 'light' | 'dark';
type DescriptionDensity = 'comfortable' | 'compact';

applyStoredTheme();
applyStoredDescriptionDensity();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </React.StrictMode>,
);

function applyTheme(theme: DeepSeekTheme | null | undefined) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
    return;
  }
  root.removeAttribute('data-theme');
  root.style.removeProperty('color-scheme');
}

function applyStoredTheme() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

  chrome.runtime.sendMessage({ type: 'GET_DEEPSEEK_THEME' })
    .then((theme: DeepSeekTheme | null) => applyTheme(theme))
    .catch(() => applyTheme(null));

  chrome.runtime.onMessage.addListener((message: { type?: string; theme?: DeepSeekTheme }) => {
    if (message.type === 'THEME_UPDATED') {
      applyTheme(message.theme);
    }
  });
}

function applyDescriptionDensity(density: DescriptionDensity | null | undefined) {
  document.documentElement.dataset.descriptionDensity = density === 'compact' ? 'compact' : 'comfortable';
}

function normalizeDescriptionDensity(value: unknown): DescriptionDensity {
  return value === 'compact' ? 'compact' : 'comfortable';
}

function applyStoredDescriptionDensity() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) return;

  chrome.runtime.sendMessage({ type: 'GET_PERSONAL_CONVENIENCE_CONFIG' })
    .then((result: { config?: { descriptionDensity?: unknown } } | null) => {
      applyDescriptionDensity(normalizeDescriptionDensity(result?.config?.descriptionDensity));
    })
    .catch(() => applyDescriptionDensity('comfortable'));

  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes.deepseek_pp_personal_convenience) return;
    const next = changes.deepseek_pp_personal_convenience.newValue as { descriptionDensity?: unknown } | undefined;
    applyDescriptionDensity(normalizeDescriptionDensity(next?.descriptionDensity));
  });
}
