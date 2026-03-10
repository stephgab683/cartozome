import { defineConfig } from "vite";

export default defineConfig({
  build: {
    sourcemap: true
  },

  server: {
    proxy: {
      "/cartozome_geoserver": {
        target: "http://localhost:8081",
        changeOrigin: true
      },
      "/cartozome_api": {
        target: "http://localhost:8000",
        changeOrigin: true
      },
      "/data": {
        target: "http://localhost",
        changeOrigin: true
      }
    }
  }
});