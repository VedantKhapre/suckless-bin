const lambdaFolder = "../../lambda/src";

process.env.TABLE_NAME ??= "mock-pastes";
process.env.FILES_BUCKET ??= "mock-files";
process.env.AUTH_PEPPER ??= "dev-only-pepper-dev-only-pepper-dev-only";
process.env.TURNSTILE_SECRET_KEY ??= "dev-only-secret";
process.env.DAILY_PASTE_LIMIT ??= "2";
process.env.UNLOCK_MAX_ATTEMPTS ??= "5";

const { handler, routes } = await import(`${lambdaFolder}/index.mjs`);
const { ddb, s3 } = await import(`${lambdaFolder}/data/clients.mjs`);

const PORT = 8787;
const LAMBDA_PAYLOAD_LIMIT = 6_291_556;
const SPEED = Number(process.env.MOCK_DELAY ?? 1);

const DELAY_MS: Record<string, number> = {
  "POST /paste": 900,
  "GET /paste/{slug}": 400,
  "POST /paste/{slug}/unlock": 600,
  "PUT /paste/{slug}/file/{index}": 700,
  "GET /paste/{slug}/file/{index}": 500,
  "POST /paste/{slug}/file/{index}": 600,
};

const JITTER_MS: Record<string, number> = {
  "PUT /paste/{slug}/file/{index}": 1200,
};

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const awsError = (name: string, status: number) =>
  Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });

const table = new Map<string, Record<string, any>>();
const files = new Map<string, Buffer>();

function putItem(input: any) {
  if (table.has(input.Item.slug)) throw awsError("ConditionalCheckFailedException", 400);
  table.set(input.Item.slug, structuredClone(input.Item));
  return {};
}

function getItem(input: any) {
  return { Item: structuredClone(table.get(input.Key.slug)) };
}

function updateCounter(input: any) {
  const values = input.ExpressionAttributeValues ?? {};
  const slug = input.Key.slug;

  if (values[":minus"] !== undefined) {
    const current = table.get(slug);
    if (!current || !(current.count > 0)) throw awsError("ConditionalCheckFailedException", 400);
    current.count += values[":minus"];
    return {};
  }

  const item = table.get(slug) ?? { slug };
  const isFull = item.count !== undefined && item.count >= values[":max"];
  if (input.ConditionExpression && isFull) throw awsError("ConditionalCheckFailedException", 400);

  item.count = (item.count ?? 0) + 1;
  item.ttl = values[":ttl"];
  table.set(slug, item);
  return {};
}

ddb.send = async (command: any) => {
  const name = command.constructor.name;
  if (name === "PutCommand") return putItem(command.input);
  if (name === "GetCommand") return getItem(command.input);
  if (name === "UpdateCommand") return updateCounter(command.input);
  throw new Error(`mock: unsupported DynamoDB command ${name}`);
};

function putObject(input: any) {
  if (input.IfNoneMatch === "*" && files.has(input.Key)) throw awsError("PreconditionFailed", 412);
  files.set(input.Key, Buffer.from(input.Body));
  return {};
}

function getObject(input: any) {
  const file = files.get(input.Key);
  if (!file) throw awsError("NoSuchKey", 404);
  return { Body: { transformToByteArray: async () => new Uint8Array(file) } };
}

s3.send = async (command: any) => {
  const name = command.constructor.name;
  if (name === "PutObjectCommand") return putObject(command.input);
  if (name === "GetObjectCommand") return getObject(command.input);
  throw new Error(`mock: unsupported S3 command ${name}`);
};

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  if (!url.startsWith(SITEVERIFY_URL)) return realFetch(input, init);

  const token = new URLSearchParams(init?.body).get("response");
  return Response.json({
    success: Boolean(token) && token !== "fail",
    action: "create-paste",
  });
}) as typeof fetch;

const routeMatchers = Object.keys(routes).map((routeKey) => {
  const [method, template] = routeKey.split(" ");
  const paramNames: string[] = [];
  const regexSource = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return { routeKey, method, pattern: new RegExp(`^${regexSource}$`), paramNames };
});

function findRoute(method: string, pathname: string) {
  for (const matcher of routeMatchers) {
    if (matcher.method !== method) continue;
    const match = pathname.match(matcher.pattern);
    if (!match) continue;

    const pathParameters = Object.fromEntries(
      matcher.paramNames.map((name, i) => [name, match[i + 1]]),
    );
    return { routeKey: matcher.routeKey, pathParameters };
  }
  return undefined;
}

async function readBody(req: Request, isBinary: boolean) {
  if (req.method === "GET") return undefined;
  if (isBinary) return Buffer.from(await req.arrayBuffer()).toString("base64");
  return req.text();
}

function jsonReply(status: number, data: unknown) {
  return Response.json(data, { status, headers: CORS_HEADERS });
}

export async function handle(req: Request): Promise<Response> {
  const { pathname } = new URL(req.url);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });

  const route = findRoute(req.method, pathname);
  if (!route) return jsonReply(404, { message: "Not Found" });

  const isBinary = (req.headers.get("content-type") ?? "").startsWith("application/octet-stream");
  const body = await readBody(req, isBinary);
  if (body && body.length > LAMBDA_PAYLOAD_LIMIT) {
    return jsonReply(500, { message: "Internal Server Error" });
  }

  const delay = (DELAY_MS[route.routeKey] ?? 0) + Math.random() * (JITTER_MS[route.routeKey] ?? 0);
  await sleep(delay * SPEED);

  const lambdaResponse = await handler({
    routeKey: route.routeKey,
    rawPath: pathname,
    pathParameters: route.pathParameters,
    headers: Object.fromEntries(req.headers),
    body: body || undefined,
    isBase64Encoded: isBinary && Boolean(body),
    requestContext: {
      http: { method: req.method, sourceIp: req.headers.get("x-mock-ip") ?? "127.0.0.1" },
    },
  });

  const payload = lambdaResponse.isBase64Encoded
    ? new Uint8Array(Buffer.from(lambdaResponse.body, "base64"))
    : lambdaResponse.body;

  return new Response(payload as BodyInit, {
    status: lambdaResponse.statusCode,
    headers: { ...CORS_HEADERS, ...lambdaResponse.headers },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const response = await handle(req);
    console.log(`${req.method} ${new URL(req.url).pathname} -> ${response.status}`);
    return response;
  },
});

console.log(`mock api running on http://localhost:${PORT}`);