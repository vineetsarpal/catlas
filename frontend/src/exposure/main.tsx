import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMonitorQueryClient } from '../monitor/query';
import { ExposureWorkbench } from './ExposureWorkbench';
const queryClient = createMonitorQueryClient();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><ExposureWorkbench initialMode={(['portfolios','monitor','exposure','recovery'].includes(new URLSearchParams(location.search).get('mode')??'')?new URLSearchParams(location.search).get('mode'):'exposure') as 'portfolios'|'monitor'|'exposure'|'recovery'}/></QueryClientProvider></React.StrictMode>);
