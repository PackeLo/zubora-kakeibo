import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    server: { deps: { inline: ["@cloudflare/workers-oauth-provider"] } },
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"]
    }
  },
  resolve: {
    alias: {
      "cloudflare:workers": new URL("./tests/helpers/worker-platform.ts", import.meta.url).pathname,
      "@back": "/app/back/src",
      "@front": "/app/front/src"
    }
  }
});
