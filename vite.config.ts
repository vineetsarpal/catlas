import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ plugins: [react()], base: './', build: { rollupOptions: { input: { main: 'index.html', exposure: 'exposure.html' } } }, test: { include: ['src/**/*.test.ts'] } } as Parameters<typeof defineConfig>[0]);
