/**
 * The commit this bundle was built from.
 *
 * `vite.config.ts` bakes `VITE_BUILD_COMMIT` in at build time, from whichever
 * builder is doing the building — GitHub Actions, a Cloudflare Workers Build, a
 * Pages build, or plain git in a working directory. This reads it back.
 *
 * It exists because there was no way to ask banan.to which commit it was
 * running, and that gap is not academic: it is how «production is serving the
 * reverted version» became something believed instead of read, while a second
 * deploy path had in fact put the newer commit live within a minute of the
 * push.
 */
export const BUILD_COMMIT_UNKNOWN = "unknown";

/**
 * The stamp, cleaned up — kept separate from reading it so it can be tested.
 *
 * `import.meta.env` is replaced statically by Vite, which means a test cannot
 * stub it: whatever the build put there is what the accessor returns, in the
 * suite as much as in the Worker. So the judgement lives here, where a test can
 * hand it the cases that matter, and the accessor below is the one line that
 * cannot be exercised any other way.
 *
 * `"unknown"` is a real answer and a deliberate one. A bundle built without the
 * define must say it does not know, because the alternatives are all worse:
 * reading git at REQUEST time is impossible inside a Worker, and falling back
 * to a version number or a date invents an answer. A verification that accepts
 * a guessed commit verifies nothing.
 */
export const normalizeCommit = (value: unknown): string => {
  if (typeof value !== "string") return BUILD_COMMIT_UNKNOWN;
  const trimmed = value.trim();
  return trimmed ? trimmed : BUILD_COMMIT_UNKNOWN;
};

/** The short form a person reads, matching what Cloudflare prints for a version. */
export const shorten = (commit: string): string =>
  commit === BUILD_COMMIT_UNKNOWN ? commit : commit.slice(0, 8);

export const buildCommit = (): string => normalizeCommit(import.meta.env?.VITE_BUILD_COMMIT);

export const shortBuildCommit = (): string => shorten(buildCommit());
