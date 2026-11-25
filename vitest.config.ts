import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {include: ['back-end/src/**/*.test.ts','front-end/src/**/*.test.ts','shared/**/*.test.ts']}
});
