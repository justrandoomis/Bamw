import { execSync } from "node:child_process";

import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";

/**
 * Which commit is banan.to running?
 *
 * Until now there was no way to ask. `/api/health` reported the database, the
 * bucket, the catalogue count and the latency — everything except the one fact
 * that tells you whether the code you are looking at is the code that is
 * serving. So «production is serving the reverted version» was something I
 * BELIEVED rather than something I had read, and it was wrong: a second deploy
 * path had already put the newer commit live, about fifty seconds after the
 * push, and nothing anywhere would have said so.
 *
 * Baked in at build time, by whoever does the building:
 *
 *   - `GITHUB_SHA` — a GitHub Actions run;
 *   - `WORKERS_CI_COMMIT_SHA` — a Cloudflare Workers Build;
 *   - `CF_PAGES_COMMIT_SHA` — a Cloudflare Pages build;
 *   - and failing all of those, whatever git says here.
 *
 * That order matters: the CI variable is the truth about what was CHECKED OUT,
 * while git in the working directory can be dirty. The git read is the last
 * resort, and `"unknown"` is honest when even that fails — a build that cannot
 * name its commit should say so, not guess one.
 */
const buildCommit = () => {
  const fromEnv =
    process.env.GITHUB_SHA ||
    process.env.WORKERS_CI_COMMIT_SHA ||
    process.env.CF_PAGES_COMMIT_SHA;
  if (fromEnv) return fromEnv.trim().slice(0, 40);
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .slice(0, 40);
  } catch {
    return "unknown";
  }
};

export default defineConfig({
  plugins: [
    tsconfigPaths(),
    tailwindcss(),
    tanstackStart(),
    react(),
  ],
  define: {
    "import.meta.env.VITE_BUILD_COMMIT": JSON.stringify(buildCommit()),
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
  },
});
