import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initTelegram } from './services/platform/telegram';
import { requestPersistence } from './services/storage/db';
import './styles/app.css';

initTelegram();
void requestPersistence();

// Keyboard-aware viewport height for mobile browsers and Telegram webviews.
const setVh = () => document.documentElement.style.setProperty('--vvh', `${window.visualViewport?.height ?? window.innerHeight}px`);
setVh();
window.visualViewport?.addEventListener('resize', setVh);
window.addEventListener('resize', setVh);

createRoot(document.getElementById('root')!).render(<App />);
