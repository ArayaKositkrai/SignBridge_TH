import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Docker Desktop on Windows/macOS does not forward file-change events
    // from bind mounts, so poll to keep hot reload working.
    watch: { usePolling: true, interval: 300 },
  },
});
