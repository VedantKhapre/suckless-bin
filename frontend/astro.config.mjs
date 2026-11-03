// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

const SLUG = /^\/[A-Za-z]{6,10}\/?$/;

/** @type {import('vite').Plugin} */
const pasteSlugRewrite = {
  name: "paste-slug-rewrite",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      const [path, query] = (req.url ?? "").split("?");
      if (SLUG.test(path)) req.url = "/paste" + (query ? `?${query}` : "");
      next();
    });
  },
};

// https://astro.build/config
export default defineConfig({
  site: "https://sucklessbin.hivedant.in",
  integrations: [react()],

  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: "IBM Plex Mono",
      cssVariable: "--font-ibm",
      weights: [400],
    },
  ],

  security: {
    csp: {
      algorithm: "SHA-256",
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "media-src 'self' blob:",
        "connect-src 'self' https://sucklessbin.hivedant.in https://api.sucklessbin.hivedant.in https://challenges.cloudflare.com",
        "font-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-src https://challenges.cloudflare.com",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
      ],
      scriptDirective: {
        resources: [
          "'self'",
          "'wasm-unsafe-eval'",
          "https://challenges.cloudflare.com",
        ],
      },
      styleDirective: {
        resources: [
          "'self'",
          { resource: "'self'", kind: "element" },
          { resource: "'unsafe-inline'", kind: "element" },
        ],
      },
    },
  },

  vite: {
    plugins: [tailwindcss(), pasteSlugRewrite],
    server: {
      // allowedHosts: [".trycloudflare.com"], // for tunnels remove on production
      proxy: {
        "/api": {
          target: "http://localhost:8787",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
  },
});