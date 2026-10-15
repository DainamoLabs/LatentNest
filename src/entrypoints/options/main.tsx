import { createRoot } from 'react-dom/client';
import { OptionsApp } from '@/options/OptionsApp';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import '@/styles/app.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <OptionsApp />
  </ErrorBoundary>,
);
