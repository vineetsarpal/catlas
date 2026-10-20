import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: './', server:{proxy:{'/api/monitor':{target:'http://127.0.0.1:3001',changeOrigin:true}}}, build: { rollupOptions: { input: { main: 'index.html', exposure: 'exposure.html' } } }, test: { include: ['src/**/*.test.ts'] } } as Parameters<typeof defineConfig>[0]);
