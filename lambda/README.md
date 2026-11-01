# sucklessbin API (Lambda)

One Lambda function answers every API call. API Gateway hands it a request, it answers with JSON (or file bytes).
No packages are needed to deploy: the Node.js runtime already includes the AWS SDK.

## What happens to a request

```
browser -> Cloudflare -> API Gateway -> index.mjs -> one file in routes/ -> DynamoDB / S3
```

1. `index.mjs` looks at `"METHOD /path"` and picks the route function.
2. The route function does its steps in order (each file starts with a comment listing them).
3. Anything that goes wrong is thrown as an `HttpError(status, message)`. `index.mjs` turns it into a JSON answer.
   Unexpected errors become a plain 500 and are logged, never shown to the visitor.

## The endpoints

| Request | File | What it does |
|---|---|---|
| `POST /paste` | `routes/create-paste.mjs` | validate, verify Turnstile, count the daily limit, save |
| `GET /paste/{slug}` | `routes/get-paste.mjs` | public: everything. private: only what is needed to ask for a password |
| `POST /paste/{slug}/unlock` | `routes/unlock-paste.mjs` | check the password proof, return the encrypted text |
| `PUT /paste/{slug}/file/{index}` | `routes/upload-file.mjs` | store one file (once, exact declared size) |
| `GET /paste/{slug}/file/{index}` | `routes/download-file.mjs` | download a file of a public paste |
| `POST /paste/{slug}/file/{index}` | `routes/download-file.mjs` | download a file of a private paste (needs the password proof) |

## Where things live

```
src/
  index.mjs            entry point: the route table + error handling
  config.mjs           ALL settings: environment variables and every limit
  http.mjs             HttpError, json(), bytes(), readJson(), readBytes()
  validate.mjs         checks what the browser sends (and the link in the URL)
  slug.mjs             makes new links (10 random letters)
  routes/              one file per endpoint (+ load-paste.mjs, shared by the ones that open a paste)
  security/
    turnstile.mjs      "is this a real person?" (asks Cloudflare)
    password.mjs       checks a private paste's password proof
    rate-limits.mjs    daily creation limit + password attempt limit
    visitor.mjs        who is the visitor, and which "network" do they belong to
  data/
    clients.mjs        the two AWS connections (DynamoDB, S3)
    paste-store.mjs    save and load pastes
    counters.mjs       the small counters behind the rate limits
    file-store.mjs     save and load files
test/api.test.mjs      the tests (in-memory fakes, no AWS needed)
```

## The rules, in plain words

- **A paste lives 20 minutes to 8 hours**, then it is gone (DynamoDB deletes it; reads also check the clock themselves).
- **5 pastes per day per visitor network**, resets at 00:00 UTC. IPv6 visitors count by /64.
- **10 wrong passwords per paste, per network, per 15 minutes.** Only that network is paused. Everyone else can still unlock. A correct password never uses up the budget.
- **Files**: up to 5 per paste, 4 MiB each (Lambda's 6 MB request limit, plus base64 overhead).
- **Private pastes** are encrypted in the browser. The server only keeps ciphertext and a hash of the password proof.

## Who is the visitor?

Behind the Cloudflare proxy, the address that connects to API Gateway is a Cloudflare server.
Cloudflare puts the real visitor in the `cf-connecting-ip` header, and `security/visitor.mjs` believes that header
**only if the connection comes from one of Cloudflare's published address ranges**. Anyone who skips Cloudflare and calls
API Gateway directly is counted by their own address, so forging the header gets them nothing.
No secret header is needed. Cloudflare's ranges (https://www.cloudflare.com/ips) rarely change; check them once a year.

## Changing a limit

Everything is in `src/config.mjs`. Three can be changed without touching code, through environment variables
(set them in the Terraform `environment` block): `DAILY_PASTE_LIMIT`, `UNLOCK_MAX_ATTEMPTS`.
If you change a file limit, change the same number in the frontend.

## Tests

```
npm install     # only needed for tests; the deployed function needs nothing
npm test
```
