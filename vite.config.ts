import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Relative asset URLs so the same build works at a domain root and under a
  // GitHub Pages project path such as /PaintByNumber/.
  base: "./",
  plugins: [react()],
  worker: {
    format: "es",
  },
});
