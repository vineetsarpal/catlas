import React from 'react';
import ReactDOM from 'react-dom/client';
import { ExposureWorkbench } from './exposure/ExposureWorkbench';
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ExposureWorkbench initialMode={new URLSearchParams(location.search).get('mode')==='exposure'?'exposure':'recovery'}/></React.StrictMode>);
