import React from 'react';
import ReactDOM from 'react-dom/client';
import { ExposureWorkbench } from './exposure/ExposureWorkbench';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ExposureWorkbench initialMode={(['monitor','exposure','recovery'].includes(new URLSearchParams(location.search).get('mode')??'')?new URLSearchParams(location.search).get('mode'):'recovery') as 'monitor'|'exposure'|'recovery'}/></React.StrictMode>);
