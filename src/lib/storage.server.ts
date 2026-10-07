/**
 * Private Cloudflare R2 object storage & internal JSON persistence.
 *
 * Dedicated strictly to BANANTO_PRIVATE_BUCKET for internal documents,
 * database fallbacks, chat attachments, private order receipts, and wallet proof.
 *
 * All private binary objects are stored with strict "private, no-store" metadata.
 */

import { getBinding } from "./env.server";

export type R2ObjectBodyLike = {
  text: () => Promise<string>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  body?: ReadableStream<Uint8Array>;
  size?: number;
  etag?: string;
  httpMetadata?: { contentType?: string; cacheControl?: string };
};

export type R2Like = {
  get: (
    key: string,
    options?: { range?: { offset: number; length?: number } },
  ) => Promise<R2ObjectBodyLike | null>;
  head?: (
    key: string,
  ) => Promise<{ size?: number; etag?: string; httpMetadata?: { contentType?: string } } | null>;
  put: (
    key: string,
    value: string | ArrayBuffer | Uint8Array | ReadableStream,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ) => Promise<unknown>;
  list: (options?: { prefix?: string; limit?: number; cursor?: string }) => Promise<{
    objects: { key: string; size?: number; uploaded?: Date }[];
  }>;
  delete: (key: string) => Promise<unknown>;
};

const memory = new Map<string, string>();
const memoryBinary = new Map<string, { bytes: Uint8Array; mime: string }>();

export function getPrivateBucket(): R2Like | undefined {
  // Check request-scoped env first, then fallback
  const bucket = getBinding<R2Like>("BANANTO_PRIVATE_BUCKET");
  if (bucket && typeof bucket.get === "function") return bucket;

  const globalEnv = (globalThis as { __CF_ENV__?: Record<string, unknown> }).__CF_ENV__;
  const globalBucket = globalEnv?.["BANANTO_PRIVATE_BUCKET"] as R2Like | undefined;
  if (globalBucket && typeof globalBucket.get === "function") return globalBucket;

  return undefined;
}

async function fsModule() {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    return { fs, path };
  } catch {
    return undefined;
  }
}

const DATA_DIR = ".data";

export function safeStorageKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 512 &&
    !key.startsWith("/") &&
    !key.includes("\\") &&
    /^[a-zA-Z0-9._/-]+$/.test(key) &&
    !/(?:^|\/)\.\.?(?:\/|$)/.test(key)
  );
}

function filePath(key: string): string {
  if (!safeStorageKey(key)) throw new Error("INVALID_STORAGE_KEY");
  return `${DATA_DIR}/${key}`;
}

export async function readRaw(key: string): Promise<string | undefined> {
  if (!safeStorageKey(key)) return undefined;
  const bucket = getPrivateBucket();
  if (bucket) {
    const obj = await bucket.get(key);
    return obj ? await obj.text() : undefined;
  }
  const mod = await fsModule();
  if (mod) {
    try {
      return await mod.fs.readFile(filePath(key), "utf-8");
    } catch {
      return memory.get(key);
    }
  }
  return memory.get(key);
}

export async function writeRaw(key: string, value: string): Promise<void> {
  if (!safeStorageKey(key)) throw new Error("INVALID_STORAGE_KEY");
  const bucket = getPrivateBucket();
  if (bucket) {
    await bucket.put(key, value, {
      httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" },
    });
    return;
  }
  memory.set(key, value);
  const mod = await fsModule();
  if (mod) {
    try {
      const target = filePath(key);
      await mod.fs.mkdir(mod.path.dirname(target), { recursive: true });
      await mod.fs.writeFile(target, value, "utf-8");
    } catch {
      /* memory copy already stored */
    }
  }
}

export async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await readRaw(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson<T>(key: string, value: T): Promise<T> {
  await writeRaw(key, JSON.stringify(value));
  return value;
}

/** Read-modify-write a single document. */
export async function mutateJson<T>(
  key: string,
  fallback: T,
  mutate: (current: T) => T,
): Promise<T> {
  const current = await readJson<T>(key, fallback);
  const next = mutate(current);
  await writeJson(key, next);
  return next;
}

export async function listKeys(prefix: string): Promise<string[]> {
  if (!safeStorageKey(prefix)) return [];
  const bucket = getPrivateBucket();
  if (bucket) {
    const result = await bucket.list({ prefix });
    return result.objects.map((o) => o.key);
  }
  const mod = await fsModule();
  const keys = new Set<string>();
  for (const key of memory.keys()) if (key.startsWith(prefix)) keys.add(key);
  for (const key of memoryBinary.keys()) if (key.startsWith(prefix)) keys.add(key);
  if (mod) {
    try {
      const dir = filePath(prefix.endsWith("/") ? prefix : `${prefix}`);
      const base = dir.endsWith("/") ? dir : mod.path.dirname(dir);
      const entries = await mod.fs.readdir(base);
      for (const entry of entries) {
        const key = `${prefix.endsWith("/") ? prefix : `${mod.path.dirname(prefix)}/`}${entry}`;
        if (key.startsWith(prefix)) keys.add(key);
      }
    } catch {
      /* nothing on disk yet */
    }
  }
  return [...keys];
}

/**
 * Binary objects (private uploads, chat receipts, verification docs)
 * are stored in BANANTO_PRIVATE_BUCKET with private, no-store headers.
 */
export async function writeBinary(
  key: string,
  bytes: Uint8Array,
  contentType: string,
  options?: { cacheControl?: string },
) {
  if (!safeStorageKey(key)) throw new Error("INVALID_STORAGE_KEY");
  const cacheControl = options?.cacheControl ?? "private, no-store";
  const bucket = getPrivateBucket();
  if (bucket) {
    await bucket.put(key, bytes, {
      httpMetadata: { contentType, cacheControl },
    });
    return;
  }
  memoryBinary.set(key, { bytes, mime: contentType });
  const mod = await fsModule();
  if (mod) {
    try {
      const target = filePath(key);
      await mod.fs.mkdir(mod.path.dirname(target), { recursive: true });
      await mod.fs.writeFile(target, bytes);
      await mod.fs.writeFile(`${target}.meta`, JSON.stringify({ mime: contentType }));
    } catch {
      /* memory copy already stored */
    }
  }
}

export interface BinaryStreamResult {
  stream?: ReadableStream<Uint8Array>;
  bytes?: Uint8Array;
  mime: string;
  size?: number;
  etag?: string;
}

/**
 * Stream binary from BANANTO_PRIVATE_BUCKET directly to avoid Worker memory bloat.
 */
export async function readBinaryStream(key: string): Promise<BinaryStreamResult | undefined> {
  if (!safeStorageKey(key)) return undefined;
  const bucket = getPrivateBucket();
  if (bucket) {
    const obj = await bucket.get(key);
    if (!obj) return undefined;
    const mime = obj.httpMetadata?.contentType || "application/octet-stream";
    if (obj.body) {
      return {
        stream: obj.body,
        mime,
        size: obj.size,
        etag: obj.etag,
      };
    }
    if (typeof obj.arrayBuffer === "function") {
      const buffer = await obj.arrayBuffer();
      return {
        bytes: new Uint8Array(buffer),
        mime,
        size: buffer.byteLength,
        etag: obj.etag,
      };
    }
  }

  // Local/memory fallback for dev
  const mem = memoryBinary.get(key);
  if (mem) {
    return { bytes: mem.bytes, mime: mem.mime, size: mem.bytes.byteLength };
  }

  const mod = await fsModule();
  if (mod) {
    try {
      const target = filePath(key);
      const data = await mod.fs.readFile(target);
      let mime = "application/octet-stream";
      try {
        const metaRaw = await mod.fs.readFile(`${target}.meta`, "utf-8");
        const meta = JSON.parse(metaRaw) as { mime?: string };
        if (meta.mime) mime = meta.mime;
      } catch {
        // ignore missing meta file
      }
      const bytes = new Uint8Array(data);
      return { bytes, mime, size: bytes.byteLength };
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export async function hasObject(key: string): Promise<boolean> {
  if (!safeStorageKey(key)) return false;
  const bucket = getPrivateBucket();
  if (bucket) {
    const obj = await bucket.get(key);
    return obj !== null && obj !== undefined;
  }
  if (memoryBinary.has(key) || memory.has(key)) return true;
  const mod = await fsModule();
  if (mod) {
    try {
      await mod.fs.access(filePath(key));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * One byte range of a stored file, for a `Range:` request.
 *
 * Safari plays no `<audio>` or `<video>` whose server cannot answer one: it
 * opens with `Range: bytes=0-1`, and a plain 200 with the whole file is taken
 * as "this source cannot be played". Voice notes therefore need this, and
 * every clip in the chat plays better for it.
 *
 * `header` is the raw `Range` value. Returns undefined when the object does
 * not exist or the header is not one simple range (the caller then serves the
 * whole file), and `{ unsatisfiable }` when it asks past the end.
 */
export async function readBinaryRange(
  key: string,
  header: string,
): Promise<
  | {
      body: ReadableStream<Uint8Array> | Uint8Array;
      mime: string;
      size: number;
      start: number;
      end: number;
      etag?: string;
    }
  | { unsatisfiable: true; size: number }
  | undefined
> {
  if (!safeStorageKey(key)) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return undefined;

  const bounds = (size: number) => {
    let start: number;
    let end: number;
    if (match[1] === "") {
      /* bytes=-N: the last N bytes. */
      const suffix = Number(match[2]);
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = Number(match[1]);
      end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
    }
    return start >= size || end < start ? null : { start, end };
  };

  const bucket = getPrivateBucket();
  if (bucket && typeof bucket.head === "function") {
    const head = await bucket.head(key);
    if (!head) return undefined;
    const size = Number(head.size ?? 0);
    const range = bounds(size);
    if (!range) return { unsatisfiable: true, size };
    const obj = await bucket.get(key, {
      range: { offset: range.start, length: range.end - range.start + 1 },
    });
    if (!obj) return undefined;
    const mime =
      obj.httpMetadata?.contentType || head.httpMetadata?.contentType || "application/octet-stream";
    const body =
      obj.body ?? (obj.arrayBuffer ? new Uint8Array(await obj.arrayBuffer()) : undefined);
    if (!body) return undefined;
    return { body, mime, size, ...range, etag: obj.etag ?? head.etag };
  }

  /* No ranged reads here (dev, or an older binding): slice the whole file. */
  const whole = await readBinary(key);
  if (!whole) return undefined;
  const size = whole.bytes.byteLength;
  const range = bounds(size);
  if (!range) return { unsatisfiable: true, size };
  return {
    body: whole.bytes.slice(range.start, range.end + 1),
    mime: whole.mime,
    size,
    ...range,
  };
}

export async function readBinary(
  key: string,
): Promise<{ bytes: Uint8Array; mime: string } | undefined> {
  const result = await readBinaryStream(key);
  if (!result) return undefined;
  if (result.bytes) {
    return { bytes: result.bytes, mime: result.mime };
  }
  if (result.stream) {
    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.byteLength;
      }
    }
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { bytes: combined, mime: result.mime };
  }
  return undefined;
}

export async function deleteObject(key: string): Promise<boolean> {
  if (!safeStorageKey(key)) return false;
  const bucket = getPrivateBucket();
  if (bucket) {
    await bucket.delete(key);
    return true;
  }
  memory.delete(key);
  memoryBinary.delete(key);
  const mod = await fsModule();
  if (mod) {
    try {
      await mod.fs.unlink(filePath(key));
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

export const deleteStoreKey = deleteObject;

export async function writeStream(
  key: string,
  stream: ReadableStream,
  contentType: string,
  options?: { cacheControl?: string },
) {
  if (!safeStorageKey(key)) throw new Error("INVALID_STORAGE_KEY");
  const cacheControl = options?.cacheControl ?? "private, no-store";

  const bucket = getPrivateBucket();
  if (bucket) {
    await bucket.put(key, stream, {
      httpMetadata: { contentType, cacheControl },
    });
    return;
  }

  // Local/memory fallback for dev - requires buffering the stream
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLen += value.byteLength;
    }
  }
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  memoryBinary.set(key, { bytes: combined, mime: contentType });

  const mod = await fsModule();
  if (mod) {
    try {
      const target = filePath(key);
      await mod.fs.mkdir(mod.path.dirname(target), { recursive: true });
      await mod.fs.writeFile(target, combined);
      await mod.fs.writeFile(`${target}.meta`, JSON.stringify({ mime: contentType }));
    } catch {
      /* memory copy already stored */
    }
  }
}
