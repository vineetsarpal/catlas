import { defineConfig, devices } from '@playwright/test';
const port=Number(process.env.CATLAS_E2E_PORT??4173);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid CATLAS_E2E_PORT');
export default defineConfig({testDir:'./tests/e2e',fullyParallel:true,use:{baseURL:`http://127.0.0.1:${port}`,launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}},webServer:{env:{CATLAS_ARCHIVE_API_ORIGIN:'',CATLAS_ARCHIVE_PROOF_TOKEN:''},command:`npm run dev -- --port ${port} --strictPort`,url:`http://127.0.0.1:${port}`,reuseExistingServer:!process.env.CI&&!process.env.CATLAS_E2E_PORT},projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{viewport:{width:375,height:812},isMobile:true,hasTouch:true}}]});
