import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig(({ command }) => ({
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    // server.entry: nuestro envoltorio de errores de SSR en src/server.ts
    tanstackStart({ server: { entry: "server" } }),
    viteReact(),
    tailwindcss(),
    ...(command === "build" ? [nitro()] : []),
  ],
  resolve: { dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"] },
  // Desarrollo: el navegador ve frontend y API en el mismo origen (cookie SameSite=Strict + verificación de origen del backend).
  server: { proxy: { "/api": { target: "http://127.0.0.1:3011", changeOrigin: false } } },
}));
