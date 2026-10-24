import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// CSP only in the production build: the dev server injects inline scripts that a strict hash CSP would block.
const isProd = process.env.NODE_ENV === "production";

// Hash mode hashes the hydration bootstrap and the no-flash theme script and ships the policy as <meta>.
const csp: NonNullable<Parameters<typeof sveltekit>[0]>["csp"] = {
  mode: "hash",
  directives: {
    "default-src": ["self"],
    "script-src": ["self"],
    "style-src": ["self", "unsafe-inline"],
    "img-src": ["self", "data:"],
    "font-src": ["self"],
    "object-src": ["none"],
    "base-uri": ["self"],
    "form-action": ["self"],
  },
};

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit({
      compilerOptions: {
        runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true),
      },
      // Plain files for Caddy; unknown paths get 404.html with a real 404 status (see Caddyfile).
      adapter: adapter({ fallback: "404.html" }),
      ...(isProd ? { csp } : {}),
    }),
  ],
});
