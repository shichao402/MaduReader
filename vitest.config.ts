import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      mermaid: resolve(__dirname, 'tests/mock-mermaid.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        pretendToBeVisual: true,
        runScripts: 'dangerously'
      }
    },
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**', 'src-tauri/**'],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    sequence: {
      concurrent: false,
    },
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './.tmp/coverage',
      include: ['src/composables/**/*.ts', 'src/stores/**/*.ts'],
      exclude: [
        'src/main.ts', 'src-tauri/**', 'node_modules/**',
        '**/*.d.ts', '**/*.test.ts', '**/*.spec.ts',
        'src/**/*.vue', '**/index.ts',
        '**/*.css', '**/*.scss', '**/*.json'
      ],
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90
      },
      all: false,
      clean: true
    }
  }
})
