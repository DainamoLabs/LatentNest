import { createRoot } from 'react-dom/client';
import { App, isTab } from '@/panel/App';
import '@/styles/app.css';

document.documentElement.classList.toggle('is-tab', isTab);
createRoot(document.getElementById('root')!).render(<App />);
