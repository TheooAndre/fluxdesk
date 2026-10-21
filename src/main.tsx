import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import App from './App.tsx';import './styles/index.css';
const query=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:30_000,refetchOnWindowFocus:false}}});
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={query}><App/></QueryClientProvider></React.StrictMode>);
