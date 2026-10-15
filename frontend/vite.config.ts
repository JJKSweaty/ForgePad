import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "FORGEPAD_");
  return {
    plugins: [react()],
    server: {
      proxy: { "/api": env.FORGEPAD_API_URL || "http://127.0.0.1:8000" },
    },
  };
});
