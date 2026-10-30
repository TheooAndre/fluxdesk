import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App.tsx';
import PrivateLogin from './components/PrivateLogin.tsx';
import './styles/index.css';

const query = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000, refetchOnWindowFocus: false } },
});
const root = document.getElementById('root')!;
const app = (
  <React.StrictMode>
    <QueryClientProvider client={query}>
      {import.meta.env.VITE_FLUXDESK_APP_LOGIN === 'true' ? <PrivateLogin><App /></PrivateLogin> : <App />}
    </QueryClientProvider>
  </React.StrictMode>
);
// Production retains its already painted UI. The Vite dev server uses CSR.
if (root.dataset.prerendered === 'true') hydrateRoot(root, app);
else createRoot(root).render(app);
