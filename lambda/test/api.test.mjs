import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { beforeEach, describe, it } from "node:test";

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

process.env.TABLE_NAME = "pastes";
process.env.FILES_BUCKET = "files";
process.env.AUTH_PEPPER = "test-pepper-test-pepper-test-pepper";
process.env.TURNSTILE_SECRET_KEY = "test-turnstile-secret";

const { handler } = await import("../src/index.mjs");
const { ddb, s3 } = await import("../src/data/clients.mjs");

// ---------- in-memory AWS ----------
const table = new Map();
const bucket = new Map();
const awsError = (name, status) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

ddb.send = async (cmd) => {
  if (cmd instanceof PutCommand) {
    const { Item } = cmd.input;
    if (table.has(Item.slug)) throw awsError("ConditionalCheckFailedException", 400);
    table.set(Item.slug, structuredClone(Item));
    return {};
  }
  if (cmd instanceof GetCommand) return { Item: structuredClone(table.get(cmd.input.Key.slug)) };
  if (cmd instanceof UpdateCommand) {
    const { Key, ExpressionAttributeValues: v, ConditionExpression } = cmd.input;
    if (v[":minus"] !== undefined) { // refund
      const current = table.get(Key.slug);
      if (!current || !(current.count > 0)) throw awsError("ConditionalCheckFailedException", 400);
      current.count += v[":minus"];
      return {};
    }
    const item = table.get(Key.slug) ?? { slug: Key.slug };
    if (ConditionExpression && item.count !== undefined && item.count >= v[":max"]) {
      throw awsError("ConditionalCheckFailedException", 400);
    }
    item.count = (item.count ?? 0) + 1;
    item.ttl = v[":ttl"];
    table.set(Key.slug, item);
    return {};
  }
  throw new Error("unexpected ddb command");
};

s3.send = async (cmd) => {
  if (cmd instanceof PutObjectCommand) {
    const { Key, Body, IfNoneMatch } = cmd.input;
    if (IfNoneMatch === "*" && bucket.has(Key)) throw awsError("PreconditionFailed", 412);
    bucket.set(Key, Buffer.from(Body));
    return {};
  }
  if (cmd instanceof GetObjectCommand) {
    const data = bucket.get(cmd.input.Key);
    if (!data) throw awsError("NoSuchKey", 404);
    return { Body: { transformToByteArray: async () => new Uint8Array(data) } };
  }
  throw new Error("unexpected s3 command");
};

// ---------- fake Cloudflare siteverify ----------
const siteverifyCalls = [];
let siteverify = (form) => ({
  success: form.get("response") === "good",
  action: "create-paste",
});
globalThis.fetch = async (url, init) => {
  const form = new URLSearchParams(init.body);
  siteverifyCalls.push({ url, method: init.method, form });
  return Response.json(siteverify(form));
};

// ---------- helpers ----------
const b64 = (n) => randomBytes(n).toString("base64");
const call = async (routeKey, { params, body, binary, ip, headers } = {}) => {
  if (routeKey === "POST /paste" && body && !("turnstileToken" in body)) {
    body = { ...body, turnstileToken: "good" };
  }
  const event = { routeKey, pathParameters: params };
  if (ip) event.requestContext = { http: { sourceIp: ip } };
  if (headers) event.headers = headers;
  if (binary) Object.assign(event, { body: binary.toString("base64"), isBase64Encoded: true });
  else if (body !== undefined) event.body = JSON.stringify(body);
  const res = await handler(event);
  const isBytes = res.isBase64Encoded;
  return {
    status: res.statusCode,
    json: !isBytes && res.body ? JSON.parse(res.body) : undefined,
    bytes: isBytes ? Buffer.from(res.body, "base64") : undefined,
    headers: res.headers,
  };
};

const file = (size) => ({ name: "a.bin", size, type: "application/x-test", lastModified: 1 });
const publicBody = (extra = {}) => ({
  visibility: "public", title: "hello", expiration: "1h", language: "plaintext",
  text: "some text", totalChars: 9, filesMeta: [], ...extra,
});
const authKey = b64(32);
const privateBody = (extra = {}) => ({
  visibility: "private", title: "secret", expiration: "2h", language: "plaintext",
  totalChars: 5, filesMeta: [], salt: b64(16), iv: b64(12), authKey,
  ciphertext: b64(40), ...extra,
});

beforeEach(() => {
  table.clear();
  bucket.clear();
  siteverifyCalls.length = 0;
  siteverify = (form) => ({ success: form.get("response") === "good", action: "create-paste" });
});

describe("turnstile", () => {
  it("sends secret, token and client ip to Cloudflare, then creates", async () => {
    const res = await call("POST /paste", { body: publicBody(), ip: "203.0.113.9" });
    assert.equal(res.status, 201);
    assert.equal(siteverifyCalls.length, 1);
    const { url, method, form } = siteverifyCalls[0];
    assert.equal(url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
    assert.equal(method, "POST");
    assert.equal(form.get("secret"), "test-turnstile-secret");
    assert.equal(form.get("response"), "good");
    assert.equal(form.get("remoteip"), "203.0.113.9");
  });

  it("behind the Cloudflare proxy, reports the visitor's IP, not the edge IP", async () => {
    await call("POST /paste", { body: publicBody(), ip: "172.68.0.1", headers: { "cf-connecting-ip": "198.51.100.7" } });
    assert.equal(siteverifyCalls[0].form.get("remoteip"), "198.51.100.7");
  });

  it("403 and nothing stored for missing, bad or wrong-action tokens", async () => {
    const missing = await call("POST /paste", { body: publicBody({ turnstileToken: undefined }) });
    assert.equal(missing.status, 403);
    const empty = await call("POST /paste", { body: publicBody({ turnstileToken: "" }) });
    assert.equal(empty.status, 403);
    const bad = await call("POST /paste", { body: publicBody({ turnstileToken: "forged" }) });
    assert.equal(bad.status, 403);

    siteverify = () => ({ success: true, action: "something-else" });
    const action = await call("POST /paste", { body: publicBody() });
    assert.equal(action.status, 403);
    siteverify = () => ({ success: true });
    assert.equal((await call("POST /paste", { body: publicBody() })).status, 403);

    assert.equal(table.size, 0);
  });

  it("fails closed with 503 when Cloudflare is down", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("network down"); };
    const origError = console.error; console.error = () => {};
    try {
      assert.equal((await call("POST /paste", { body: publicBody() })).status, 503);
      assert.equal(table.size, 0);
    } finally {
      globalThis.fetch = original; console.error = origError;
    }
  });

  it("does not spend a token on invalid input", async () => {
    const res = await call("POST /paste", { body: publicBody({ expiration: "9y" }) });
    assert.equal(res.status, 400);
    assert.equal(siteverifyCalls.length, 0);
  });

  it("only guards creation, not reads or unlock", async () => {
    const { json } = await call("POST /paste", { body: publicBody() });
    siteverifyCalls.length = 0;
    await call("GET /paste/{slug}", { params: { slug: json.slug } });
    assert.equal(siteverifyCalls.length, 0);
  });
});

describe("public pastes", () => {
  it("creates and reads back, with a slug the frontend accepts", async () => {
    const created = await call("POST /paste", { body: publicBody() });
    assert.equal(created.status, 201);
    assert.match(created.json.slug, /^[A-Za-z]{10}$/);

    const got = await call("GET /paste/{slug}", { params: { slug: created.json.slug } });
    assert.equal(got.status, 200);
    assert.equal(got.json.text, "some text");
    assert.equal(got.json.totalChars, 9);
    assert.equal(got.json.visibility, "public");
    assert.ok(got.json.expiresAt > Date.now());
    assert.equal(got.headers["cache-control"], "no-store");
  });

  it("returns 404 for missing, malformed and expired slugs", async () => {
    assert.equal((await call("GET /paste/{slug}", { params: { slug: "missingxyz" } })).status, 404);
    assert.equal((await call("GET /paste/{slug}", { params: { slug: "../etc" } })).status, 404);

    const { json } = await call("POST /paste", { body: publicBody() });
    table.get(json.slug).expiresAt = Date.now() - 1;
    assert.equal((await call("GET /paste/{slug}", { params: { slug: json.slug } })).status, 404);
  });
});

describe("validation", () => {
  const cases = {
    "bad expiration": publicBody({ expiration: "9y" }),
    "empty title": publicBody({ title: "   " }),
    "blank text": publicBody({ text: "   " }),
    "too many files": publicBody({ filesMeta: Array.from({ length: 6 }, () => file(1)) }),
    "file too big": publicBody({ filesMeta: [file(5 * 1024 * 1024)] }),
    "empty file": publicBody({ filesMeta: [file(0)] }),
    "bad visibility": publicBody({ visibility: "internal" }),
  };
  for (const [name, body] of Object.entries(cases)) {
    it(`rejects ${name}`, async () => {
      assert.equal((await call("POST /paste", { body })).status, 400);
    });
  }

  it("rejects wrong-size crypto fields", async () => {
    assert.equal((await call("POST /paste", { body: privateBody({ authKey: b64(16) }) })).status, 400);
    assert.equal((await call("POST /paste", { body: privateBody({ iv: b64(16) }) })).status, 400);
    assert.equal((await call("POST /paste", { body: privateBody({ salt: "not base64!" }) })).status, 400);
  });

  it("rejects oversized and malformed bodies", async () => {
    const huge = await call("POST /paste", { body: publicBody({ text: "x".repeat(400_000) }) });
    assert.equal(huge.status, 413);
    const res = await handler({ routeKey: "POST /paste", body: "{nope" });
    assert.equal(res.statusCode, 400);
  });
});

describe("private pastes", () => {
  it("never stores the auth key and never leaks secrets before unlock", async () => {
    const { json } = await call("POST /paste", { body: privateBody() });
    const stored = table.get(json.slug);
    const dump = JSON.stringify(stored);
    assert.ok(stored.authHash);
    assert.ok(!dump.includes(authKey), "raw auth key must not be stored");
    assert.notEqual(stored.authHash, authKey);

    const locked = await call("GET /paste/{slug}", { params: { slug: json.slug } });
    assert.deepEqual(Object.keys(locked.json).sort(), ["expiresAt", "iv", "salt", "title", "visibility"]);
    assert.ok(!JSON.stringify(locked.json).includes(stored.ciphertext));
  });

  it("unlocks with the right key, 401 with a wrong one", async () => {
    const { json } = await call("POST /paste", { body: privateBody() });
    const params = { slug: json.slug };

    const bad = await call("POST /paste/{slug}/unlock", { params, body: { authKey: b64(32) } });
    assert.equal(bad.status, 401);
    const missing = await call("POST /paste/{slug}/unlock", { params, body: {} });
    assert.equal(missing.status, 401);
    const short = await call("POST /paste/{slug}/unlock", { params, body: { authKey: b64(8) } });
    assert.equal(short.status, 401);

    const ok = await call("POST /paste/{slug}/unlock", { params, body: { authKey } });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.ciphertext, table.get(json.slug).ciphertext);
    assert.deepEqual(Object.keys(ok.json).sort(), ["ciphertext", "filesMeta", "language", "totalChars"]);
  });

  it("refuses to unlock a public paste", async () => {
    const { json } = await call("POST /paste", { body: publicBody() });
    const res = await call("POST /paste/{slug}/unlock", { params: { slug: json.slug }, body: { authKey } });
    assert.equal(res.status, 400);
  });
});

describe("files", () => {
  const data = randomBytes(1000);

  it("public: upload once, download, no overwrite", async () => {
    const { json } = await call("POST /paste", { body: publicBody({ filesMeta: [file(1000)] }) });
    const params = { slug: json.slug, index: "0" };

    assert.equal((await call("GET /paste/{slug}/file/{index}", { params })).status, 404);
    assert.equal((await call("PUT /paste/{slug}/file/{index}", { params, binary: data })).status, 200);
    assert.equal((await call("PUT /paste/{slug}/file/{index}", { params, binary: data })).status, 409);

    const got = await call("GET /paste/{slug}/file/{index}", { params });
    assert.equal(got.status, 200);
    assert.ok(got.bytes.equals(data));
    assert.equal(got.headers["content-type"], "application/octet-stream");
  });

  it("rejects wrong size, bad index, text bodies and oversize", async () => {
    const { json } = await call("POST /paste", { body: publicBody({ filesMeta: [file(1000)] }) });
    const put = (index, extra) => call("PUT /paste/{slug}/file/{index}", { params: { slug: json.slug, index }, ...extra });

    assert.equal((await put("0", { binary: randomBytes(999) })).status, 400);
    assert.equal((await put("1", { binary: data })).status, 400);
    assert.equal((await put("-1", { binary: data })).status, 400);
    assert.equal((await put("abc", { binary: data })).status, 400);
    assert.equal((await put("0", { body: { not: "binary" } })).status, 415);
    assert.equal((await put("0", { binary: randomBytes(5 * 1024 * 1024) })).status, 413);
  });

  it("private: GET refused, POST needs the right key", async () => {
    const { json } = await call("POST /paste", { body: privateBody({ filesMeta: [file(1000)] }) });
    const params = { slug: json.slug, index: "0" };
    await call("PUT /paste/{slug}/file/{index}", { params, binary: data });

    assert.equal((await call("GET /paste/{slug}/file/{index}", { params })).status, 401);
    assert.equal((await call("POST /paste/{slug}/file/{index}", { params, body: { authKey: b64(32) } })).status, 401);

    const ok = await call("POST /paste/{slug}/file/{index}", { params, body: { authKey } });
    assert.equal(ok.status, 200);
    assert.ok(ok.bytes.equals(data));
  });
});

describe("password attempt cap (per network, never paste-wide)", () => {
  const A = "203.0.113.10", B = "203.0.113.20";
  const unlock = (slug, key, ip, headers) => call("POST /paste/{slug}/unlock", { params: { slug }, body: { authKey: key }, ip, headers });
  const make = async (extra) => (await call("POST /paste", { body: privateBody(extra), ip: "198.51.100.99" })).json.slug;

  it("pauses the guessing network after 10 wrong passwords, with a clear message", async () => {
    const slug = await make();
    for (let i = 0; i < 10; i++) assert.equal((await unlock(slug, b64(32), A)).status, 401);
    const blocked = await unlock(slug, b64(32), A);
    assert.equal(blocked.status, 429);
    assert.match(blocked.json.error, /^Too many wrong passwords from your network\. Try again in \d+ minutes?\.$/);
  });

  it("does NOT lock anyone else: the right password works from another network", async () => {
    const slug = await make();
    for (let i = 0; i < 12; i++) await unlock(slug, b64(32), A);
    assert.equal((await unlock(slug, b64(32), A)).status, 429, "the attacker is paused");
    const legit = await unlock(slug, authKey, B);
    assert.equal(legit.status, 200, "another user is not affected");
    assert.ok(legit.json.ciphertext);
  });

  it("a paused network is refused even with the right password (no free oracle)", async () => {
    const slug = await make();
    for (let i = 0; i < 10; i++) await unlock(slug, b64(32), A);
    assert.equal((await unlock(slug, authKey, A)).status, 429);
  });

  it("parallel guesses cannot beat the cap", async () => {
    const slug = await make();
    const results = await Promise.all(Array.from({ length: 60 }, () => unlock(slug, b64(32), A)));
    const answered = results.filter((r) => r.status === 401).length;
    assert.equal(answered, 10, "exactly 10 guesses were answered");
    assert.equal(results.filter((r) => r.status === 429).length, 50);
  });

  it("correct passwords never use up the budget", async () => {
    const slug = await make();
    for (let i = 0; i < 40; i++) assert.equal((await unlock(slug, authKey, A)).status, 200);
    for (let i = 0; i < 10; i++) assert.equal((await unlock(slug, b64(32), A)).status, 401);
  });

  it("a few typos then the right password still works", async () => {
    const slug = await make();
    for (let i = 0; i < 4; i++) await unlock(slug, b64(32), A);
    assert.equal((await unlock(slug, authKey, A)).status, 200);
  });

  it("the budget is per paste: another paste from the same network is untouched", async () => {
    const one = await make(), two = await make();
    for (let i = 0; i < 12; i++) await unlock(one, b64(32), A);
    assert.equal((await unlock(one, authKey, A)).status, 429);
    assert.equal((await unlock(two, authKey, A)).status, 200);
  });

  it("starts fresh after the 15-minute window", async () => {
    const slug = await make();
    for (let i = 0; i < 11; i++) await unlock(slug, b64(32), A);
    assert.equal((await unlock(slug, authKey, A)).status, 429);
    const realNow = Date.now;
    Date.now = () => realNow() + 15 * 60_000;
    try { assert.equal((await unlock(slug, authKey, A)).status, 200); } finally { Date.now = realNow; }
  });

  it("uses the visitor's IP behind Cloudflare, so one visitor does not pause the edge for everyone", async () => {
    const slug = await make();
    const edge = "172.68.0.1";
    for (let i = 0; i < 11; i++) await unlock(slug, b64(32), edge, { "cf-connecting-ip": "198.51.100.1" });
    assert.equal((await unlock(slug, authKey, edge, { "cf-connecting-ip": "198.51.100.1" })).status, 429);
    assert.equal((await unlock(slug, authKey, edge, { "cf-connecting-ip": "198.51.100.2" })).status, 200);
  });

  it("file downloads share the same per-network budget, and parallel previews are not blocked", async () => {
    const slug = await make({ filesMeta: [file(1000), file(1000), file(1000), file(1000), file(1000)] });
    const data = randomBytes(1000);
    for (let i = 0; i < 5; i++) await call("PUT /paste/{slug}/file/{index}", { params: { slug, index: String(i) }, binary: data });
    const dl = (i, key, ip) => call("POST /paste/{slug}/file/{index}", { params: { slug, index: String(i) }, body: { authKey: key }, ip });

    const parallel = await Promise.all([0, 1, 2, 3, 4].map((i) => dl(i, authKey, A)));
    assert.deepEqual(parallel.map((r) => r.status), [200, 200, 200, 200, 200], "5 previews at once all work");

    for (let i = 0; i < 10; i++) assert.equal((await dl(0, b64(32), A)).status, 401);
    assert.equal((await dl(0, b64(32), A)).status, 429);
    assert.equal((await unlock(slug, authKey, A)).status, 429, "unlock from the same network is paused too");
    assert.equal((await dl(0, authKey, B)).status, 200, "another network is fine");
  });

  it("stores no slug or IP in the counter key", async () => {
    const slug = await make();
    await unlock(slug, b64(32), A);
    const key = [...table.keys()].find((k) => k.startsWith("ul#"));
    assert.ok(key && !key.includes(slug) && !key.includes(A) && /^ul#[0-9a-f]{32}#\d+$/.test(key));
    assert.equal((await call("GET /paste/{slug}", { params: { slug: key } })).status, 404);
  });

  it("limit is configurable with UNLOCK_MAX_ATTEMPTS", async () => {
    process.env.UNLOCK_MAX_ATTEMPTS = "3";
    try {
      const slug = await make();
      for (let i = 0; i < 3; i++) assert.equal((await unlock(slug, b64(32), A)).status, 401);
      assert.equal((await unlock(slug, b64(32), A)).status, 429);
    } finally { delete process.env.UNLOCK_MAX_ATTEMPTS; }
  });
});

describe("daily creation limit", () => {
  const create = (ip, headers) => call("POST /paste", { body: publicBody(), ip, headers });

  it("allows 5 pastes per network per day, then 429 with a clear message", async () => {
    for (let i = 0; i < 5; i++) assert.equal((await create("203.0.113.5")).status, 201);
    const sixth = await create("203.0.113.5");
    assert.equal(sixth.status, 429);
    assert.equal(sixth.json.error, "Daily limit reached: 5 pastes per day. It resets at 00:00 UTC.");
    assert.equal([...table.values()].filter((i) => i.visibility).length, 5, "the 6th was not stored");
  });

  it("counts each network separately", async () => {
    for (let i = 0; i < 5; i++) await create("203.0.113.5");
    assert.equal((await create("203.0.113.5")).status, 429);
    assert.equal((await create("203.0.113.6")).status, 201);
  });

  it("uses the visitor IP from Cloudflare, not the proxy's address", async () => {
    for (let i = 0; i < 5; i++) await create("172.68.0.1", { "cf-connecting-ip": "198.51.100.7" });
    assert.equal((await create("172.68.0.1", { "cf-connecting-ip": "198.51.100.7" })).status, 429);
    assert.equal((await create("172.68.0.1", { "cf-connecting-ip": "198.51.100.8" })).status, 201, "other visitors behind the same edge are unaffected");
  });

  it("treats one IPv6 /64 as one network (visitors arrive through a Cloudflare address)", async () => {
    const edge = "172.68.0.1";
    for (let i = 0; i < 5; i++) await create(edge, { "cf-connecting-ip": `2001:db8:abcd:12::${i + 1}` });
    assert.equal((await create(edge, { "cf-connecting-ip": "2001:db8:abcd:12:ffff:eeee:dddd:1" })).status, 429);
    assert.equal((await create(edge, { "cf-connecting-ip": "2001:db8:abcd:13::1" })).status, 201);
  });

  it("treats IPv4-mapped IPv6 like the plain IPv4 address", async () => {
    for (let i = 0; i < 5; i++) await create("203.0.113.9");
    assert.equal((await create("::ffff:203.0.113.9")).status, 429);
  });

  it("resets the next UTC day", async () => {
    for (let i = 0; i < 5; i++) await create("203.0.113.5");
    assert.equal((await create("203.0.113.5")).status, 429);
    const realNow = Date.now;
    Date.now = () => realNow() + 24 * 3600 * 1000;
    try { assert.equal((await create("203.0.113.5")).status, 201); } finally { Date.now = realNow; }
  });

  it("is not used up by invalid requests or failed verification", async () => {
    for (let i = 0; i < 8; i++) await call("POST /paste", { body: publicBody({ expiration: "9y" }), ip: "203.0.113.5" });
    for (let i = 0; i < 8; i++) await call("POST /paste", { body: publicBody({ turnstileToken: "forged" }), ip: "203.0.113.5" });
    for (let i = 0; i < 5; i++) assert.equal((await create("203.0.113.5")).status, 201);
  });

  it("stores only a hash of the IP, and the counter cannot be read through the API", async () => {
    await create("203.0.113.77");
    const key = [...table.keys()].find((k) => k.startsWith("rl#"));
    assert.ok(key && !key.includes("203.0.113.77") && /^rl#[0-9a-f]{32}#\d{8}$/.test(key));
    assert.equal((await call("GET /paste/{slug}", { params: { slug: key } })).status, 404);
  });

  it("only guards creation: reads and unlocks are not counted", async () => {
    const { json } = await create("203.0.113.5");
    const before = table.size;
    for (let i = 0; i < 10; i++) await call("GET /paste/{slug}", { params: { slug: json.slug }, ip: "203.0.113.5" });
    assert.equal(table.size, before);
  });

  it("limit is configurable with DAILY_PASTE_LIMIT", async () => {
    process.env.DAILY_PASTE_LIMIT = "2";
    try {
      assert.equal((await create("203.0.113.5")).status, 201);
      assert.equal((await create("203.0.113.5")).status, 201);
      const third = await create("203.0.113.5");
      assert.equal(third.status, 429);
      assert.ok(third.json.error.includes("2 pastes per day"));
    } finally { delete process.env.DAILY_PASTE_LIMIT; }
  });
});

describe("who is the visitor (no secret header needed)", () => {
  const create = (ip, headers) => call("POST /paste", { body: publicBody(), ip, headers });

  it("believes cf-connecting-ip only when the connection really comes from Cloudflare", async () => {
    for (let i = 0; i < 5; i++) await create("172.68.0.1", { "cf-connecting-ip": "198.51.100.7" });
    assert.equal((await create("172.68.0.1", { "cf-connecting-ip": "198.51.100.7" })).status, 429);
    assert.equal((await create("172.68.0.1", { "cf-connecting-ip": "198.51.100.8" })).status, 201);
  });

  it("a direct hit cannot dodge the daily limit by forging the header", async () => {
    for (let i = 0; i < 5; i++) {
      assert.equal((await create("203.0.113.50", { "cf-connecting-ip": `198.51.100.${i + 1}` })).status, 201);
    }
    // five different forged values, same real address: still counted as ONE visitor
    assert.equal((await create("203.0.113.50", { "cf-connecting-ip": "198.51.100.99" })).status, 429);
  });

  it("a direct hit cannot dodge the password cap by forging the header either", async () => {
    const slug = (await call("POST /paste", { body: privateBody(), ip: "198.51.100.200" })).json.slug;
    const guess = (headers) => call("POST /paste/{slug}/unlock", { params: { slug }, body: { authKey: b64(32) }, ip: "203.0.113.50", headers });
    for (let i = 0; i < 10; i++) assert.equal((await guess({ "cf-connecting-ip": `198.51.100.${i + 1}` })).status, 401);
    assert.equal((await guess({ "cf-connecting-ip": "198.51.100.77" })).status, 429);
  });

  it("works with Cloudflare IPv6 edge addresses", async () => {
    for (let i = 0; i < 5; i++) await create("2606:4700::1", { "cf-connecting-ip": "198.51.100.7" });
    assert.equal((await create("2606:4700::1", { "cf-connecting-ip": "198.51.100.7" })).status, 429);
    assert.equal((await create("2606:4700::1", { "cf-connecting-ip": "198.51.100.8" })).status, 201);
  });

  it("ignores a Cloudflare-sent header that is not an IP address", async () => {
    for (let i = 0; i < 5; i++) await create("172.68.0.1", { "cf-connecting-ip": "not-an-ip" });
    assert.equal((await create("172.68.0.1", { "cf-connecting-ip": "also-not-an-ip" })).status, 429, "falls back to the edge address");
  });

  it("recognises Cloudflare addresses (unit)", async () => {
    const { isCloudflareAddress, visitorIp, networkOf } = await import("../src/security/visitor.mjs");
    for (const yes of ["172.68.0.1", "104.16.0.1", "173.245.48.1", "131.0.72.5", "2606:4700::1", "2a06:98c0::1", "::ffff:104.16.0.1"]) {
      assert.equal(isCloudflareAddress(yes), true, yes);
    }
    for (const no of ["8.8.8.8", "203.0.113.5", "104.15.255.255", "2001:db8::1", "garbage", "", undefined, null]) {
      assert.equal(isCloudflareAddress(no), false, String(no));
    }
    assert.equal(visitorIp({ requestContext: { http: { sourceIp: "8.8.8.8" } }, headers: { "cf-connecting-ip": "1.2.3.4" } }), "8.8.8.8");
    assert.equal(visitorIp({ requestContext: { http: { sourceIp: "104.16.0.1" } }, headers: { "cf-connecting-ip": " 1.2.3.4 " } }), "1.2.3.4");
    assert.equal(visitorIp({ requestContext: { http: { sourceIp: "104.16.0.1" } }, headers: {} }), "104.16.0.1");
    assert.equal(networkOf("2001:db8:abcd:12::1"), networkOf("2001:db8:abcd:12:ffff::9"));
    assert.notEqual(networkOf("2001:db8:abcd:12::1"), networkOf("2001:db8:abcd:13::1"));
  });

  it("sends the visitor's address to Turnstile as a plain IP string (regression)", async () => {
    await create("172.68.0.1", { "cf-connecting-ip": "198.51.100.7" });
    const sent = siteverifyCalls.at(-1).form.get("remoteip");
    assert.equal(sent, "198.51.100.7");
    assert.match(sent, /^\d+\.\d+\.\d+\.\d+$/);
  });

  it("every route that checks a password passes the visitor's address (regression)", async () => {
    // If the address were forgotten, every visitor would share one "unknown" budget.
    const slug = (await call("POST /paste", { body: privateBody({ filesMeta: [file(10)] }), ip: "198.51.100.200" })).json.slug;
    await call("PUT /paste/{slug}/file/{index}", { params: { slug, index: "0" }, binary: randomBytes(10) });
    for (let i = 0; i < 10; i++) await call("POST /paste/{slug}/unlock", { params: { slug }, body: { authKey: b64(32) }, ip: "203.0.113.1" });
    assert.equal((await call("POST /paste/{slug}/unlock", { params: { slug }, body: { authKey }, ip: "203.0.113.2" })).status, 200);
    assert.equal((await call("POST /paste/{slug}/file/{index}", { params: { slug, index: "0" }, body: { authKey }, ip: "203.0.113.2" })).status, 200);
    assert.equal((await call("POST /paste/{slug}/file/{index}", { params: { slug, index: "0" }, body: { authKey }, ip: "203.0.113.1" })).status, 429);
  });
});

describe("router", () => {
  it("404s unknown routes", async () => {
    assert.equal((await call("DELETE /paste/{slug}", {})).status, 404);
  });

  it("hides internals on unexpected errors", async () => {
    const original = ddb.send;
    ddb.send = async () => { throw new Error("secret table name pastes-prod"); };
    const logged = [];
    const origError = console.error;
    console.error = (line) => logged.push(line);
    try {
      const res = await call("GET /paste/{slug}", { params: { slug: "abcdefgh" } });
      assert.equal(res.status, 500);
      assert.deepEqual(res.json, { error: "Internal error" });
      assert.ok(logged[0].includes("secret table name"), "details go to logs only");
    } finally {
      ddb.send = original;
      console.error = origError;
    }
  });
});
