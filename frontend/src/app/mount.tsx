import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMonitorQueryClient } from '../monitor/query';
import { Workbench } from './Workbench';
import { workspaceModeFromUrl, type WorkspaceMode } from './navigation';

/** One application and query-client lifetime per entry page; mode changes retain both. */
export function mountWorkbench(defaultMode: WorkspaceMode) {
  const queryClient = createMonitorQueryClient();
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <Workbench initialMode={workspaceModeFromUrl(new URL(location.href), defaultMode)}/>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}
