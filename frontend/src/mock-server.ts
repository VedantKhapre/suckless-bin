import { timingSafeEqual } from "node:crypto";

type Paste = {
  visibility: string;
  expiration: string;
  expiresAt: number;
  authKey?: string;
  ciphertext?: string;
  filesMeta?: unknown[];
  [key: string]: unknown;
};

const store = new Map<string, Paste>();
const blobs = new Map<string, Map<number, ArrayBuffer>>();

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
};
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: cors });

const toMs = (e: string) => parseInt(e) * (e.endsWith("h") ? 3_600_000 : 60_000);

function authOk(paste: Paste, authKey: unknown) {
  if (paste.visibility !== "private" || typeof authKey !== "string" || !paste.authKey) {
    return false;
  }
  const sent = Buffer.from(authKey, "base64");
  const saved = Buffer.from(paste.authKey, "base64");
  return sent.length === saved.length && timingSafeEqual(sent, saved);
}

Bun.serve({
  port: 8787,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });

    if (req.method === "POST" && pathname === "/paste") {
      const body = await req.json();
      const slug = crypto.randomUUID().slice(0, 8);
      store.set(slug, { ...body, expiresAt: Date.now() + toMs(body.expiration) });
      console.log("stored", slug, body);
      return json({ slug });
    }

    const [, , slug, action, index] = pathname.split("/");
    const paste = slug ? store.get(slug) : undefined;
    if (!paste || paste.expiresAt < Date.now()) {
      return json({ error: "not found" }, 404);
    }

    if (req.method === "GET" && !action) {
      if (paste.visibility === "private") {
        const { visibility, title, expiresAt, salt, iv } = paste;
        return json({ visibility, title, expiresAt, salt, iv });
      }
      const { authKey, ciphertext, ...safe } = paste;
      return json(safe);
    }

    if (req.method === "POST" && action === "unlock") {
      const { authKey } = await req.json();
      if (!authOk(paste, authKey)) return json({ error: "wrong password" }, 401);
      const { ciphertext, language, totalChars, filesMeta } = paste;
      return json({ ciphertext, language, totalChars, filesMeta });
    }

    if (action === "file") {
      const i = Number(index);

      if (req.method === "PUT") {
        const count = paste.filesMeta?.length ?? 0;
        const slot = blobs.get(slug) ?? new Map<number, ArrayBuffer>();
        if (!Number.isInteger(i) || i < 0 || i >= count || slot.has(i)) {
          return json({ error: "bad request" }, 400);
        }
        slot.set(i, await req.arrayBuffer());
        blobs.set(slug, slot);
        return json({ ok: true });
      }

      const bytes = blobs.get(slug)?.get(i);
      if (!bytes) return json({ error: "not found" }, 404);

      if (req.method === "GET" && paste.visibility === "public") {
        return new Response(bytes, { headers: cors });
      }

      if (req.method === "POST" && paste.visibility === "private") {
        const { authKey } = await req.json();
        if (!authOk(paste, authKey)) return json({ error: "wrong password" }, 401);
        return new Response(bytes, { headers: cors });
      }
    }

    return json({ error: "bad request" }, 400);
  },
});

console.log("mock aws on http://localhost:8787");