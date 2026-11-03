# sucklessbin API (Lambda)

A single AWS Lambda function serves every API endpoint. API Gateway passes each request to the function, which responds with JSON or raw file bytes. The deployed function has no dependencies: the Node.js 22 runtime already includes the AWS SDK.

## Request Flow

```
browser -> API Gateway -> index.mjs -> one file in routes/ -> DynamoDB / S3
```

1. `index.mjs` matches `"METHOD /path"` against the route table and calls the route function.
2. The route function runs its steps in order. Each file begins with a comment listing those steps.
3. Errors thrown as `HttpError(status, message)` become JSON responses (`{ "error": "..." }`). Any other error is logged and returned as a generic 500. Request bodies are never logged.

### Request Routing

Every request enters through `index.mjs`, which matches the method and path against a route table.

```mermaid
flowchart TD
    REQ[Incoming request] --> INDEX[index.mjs: handler]
    INDEX --> MATCH{Match method + path}
    MATCH -->|POST /paste| CREATE[routes/create-paste.mjs]
    MATCH -->|GET /paste/:slug| GET[routes/get-paste.mjs]
    MATCH -->|POST /paste/:slug/unlock| UNLOCK[routes/unlock-paste.mjs]
    MATCH -->|PUT /paste/:slug/file/:index| UPLOAD[routes/upload-file.mjs]
    MATCH -->|GET /paste/:slug/file/:index| DOWNLOAD_GET[routes/download-file.mjs: GET handler]
    MATCH -->|POST /paste/:slug/file/:index| DOWNLOAD_POST[routes/download-file.mjs: POST handler]
    MATCH -->|No match| ERR404[Return 404]

    CREATE --> RESP[JSON response]
    GET --> RESP
    UNLOCK --> RESP
    UPLOAD --> RESP
    DOWNLOAD_GET --> BYTES[File bytes response]
    DOWNLOAD_POST --> BYTES
    ERR404 --> RESP
```

## Endpoints

The API exposes six routes, all handled by a single Lambda function.

| Request | File | Purpose |
|---|---|---|
| `POST /paste` | `routes/create-paste.mjs` | Validate input, verify Turnstile, enforce the daily limit, save the paste |
| `GET /paste/{slug}` | `routes/get-paste.mjs` | Public pastes: full content. Private pastes: only the details needed to request a password |
| `POST /paste/{slug}/unlock` | `routes/unlock-paste.mjs` | Verify the password proof and return the encrypted text |
| `PUT /paste/{slug}/file/{index}` | `routes/upload-file.mjs` | Store one file. Each index can be written once, and the size must match the declared size exactly |
| `GET /paste/{slug}/file/{index}` | `routes/download-file.mjs` | Download a file from a public paste |
| `POST /paste/{slug}/file/{index}` | `routes/download-file.mjs` | Download a file from a private paste. Requires the password proof in the body. |

## Source Layout

```
src/
  index.mjs            Entry point: route table and error handling
  config.mjs           All settings: environment variables and limits
  http.mjs             HttpError, json(), bytes(), readJson(), readBytes()
  validate.mjs         Validation of browser input and slugs
  slug.mjs             Generates paste identifiers (10 random letters)
  routes/              One file per endpoint, plus load-paste.mjs (shared by routes that open a paste)
  security/
    turnstile.mjs      Verifies the Turnstile token with Cloudflare
    password.mjs       Checks a private paste's password proof
    rate-limits.mjs    Daily creation limit and password attempt limit
    visitor.mjs        Determines the visitor's address and network
  data/
    clients.mjs        DynamoDB and S3 clients
    paste-store.mjs    Saves and loads pastes
    counters.mjs       Counters behind the rate limits
    file-store.mjs     Saves and loads files
test/api.test.mjs      Test suite (in-memory fakes, no AWS access required)
```

### Module Dependencies

The route handlers depend on shared validation, security, and data modules.

```mermaid
flowchart TB
    INDEX[index.mjs] --> ROUTES
    ROUTES[routes/] --> VALIDATE[validate.mjs]
    ROUTES --> SECURITY[security/]
    ROUTES --> DATA[data/]
    ROUTES --> HTTP[http.mjs]
    SECURITY --> VISITOR[visitor.mjs]
    SECURITY --> TURNSTILE[turnstile.mjs]
    SECURITY --> PASSWORD[password.mjs]
    SECURITY --> RATE[rate-limits.mjs]
    DATA --> CLIENTS[clients.mjs: DynamoDB + S3]
    DATA --> PASTE_STORE[paste-store.mjs]
    DATA --> FILE_STORE[file-store.mjs]
    DATA --> COUNTERS[counters.mjs]
    RATE --> COUNTERS
    RATE --> VISITOR
```

## Configuration

Environment variables are set by Terraform in the function's `environment` block.

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `TABLE_NAME` | Yes | None | DynamoDB table for pastes and rate-limit counters |
| `FILES_BUCKET` | Yes | None | Private S3 bucket for uploaded files |
| `AUTH_PEPPER` | Yes | None | Secret mixed into stored hashes (passwords and network identifiers) |
| `TURNSTILE_SECRET_KEY` | Yes | None | Cloudflare Turnstile secret key |
| `DAILY_PASTE_LIMIT` | No | `5` | Pastes allowed per network per UTC day. Set by Terraform. |
| `UNLOCK_MAX_ATTEMPTS` | No | `10` | Wrong-password attempts allowed per paste, per network, per 15 minutes. Not set by Terraform, so the default applies. |

Required variables are read when first needed. A missing variable fails the affected request with a clear error instead of stopping the function from starting.

Fixed limits are in `src/config.mjs`:

| Limit | Value |
|---|---|
| Maximum request body | 360,000 bytes |
| Files per paste | 5 |
| Maximum file size | 4 MiB (4,194,304 bytes) |
| Expiry options | 20m, 40m, 1h, 2h, 4h, 8h |
| Expiry grace period (reads) | 3,600 seconds |

The file size limit comes from Lambda's 6 MB request payload limit. Base64 encoding adds about one third, so a 4 MiB file becomes roughly 5.6 MB on the wire. If you change a file limit, change the matching value in the frontend.

## Paste Creation Flow

The `POST /paste` endpoint validates input, checks the Turnstile token, enforces the daily paste limit, and saves the paste.

```mermaid
flowchart TD
    START[POST /paste request] --> PARSE[Parse JSON body]
    PARSE --> VAL_INPUT{Valid input?}
    VAL_INPUT -->|No| ERR400[400 Bad Request]
    VAL_INPUT -->|Yes| TURNSTILE[Verify Turnstile token]
    TURNSTILE --> TS_OK{Token valid?}
    TS_OK -->|No| ERR403[403 Forbidden]
    TS_OK -->|Yes| VISITOR[Determine visitor network]
    VISITOR --> DAILY[Check daily paste counter]
    DAILY --> QUOTA{Under limit?}
    QUOTA -->|No| ERR429[429 Too Many Requests]
    QUOTA -->|Yes| GEN[Generate random slug]
    GEN --> SAVE[Save to DynamoDB]
    SAVE --> INCR[Increment daily counter]
    INCR --> RESP[Return slug]
    ERR400 --> END
    ERR403 --> END
    ERR429 --> END
    RESP --> END[Response]
```

Steps are ordered by cost: cheap validations run before the Turnstile HTTP call, which runs before the DynamoDB write.

## Rules

- **Pastes expire** after 20 minutes to 8 hours. DynamoDB removes expired items on its own schedule, which can take up to 48 hours, so every read also checks the expiry time.
- **5 pastes per day per network** (configurable), resetting at 00:00 UTC. IPv6 addresses are counted by their /64 prefix.
- **10 wrong passwords per paste, per network, per 15 minutes** (configurable). Only the offending network is paused. Other visitors can still unlock the paste. A correct password does not count against the budget.
- **Private paste contents are encrypted in the browser.** The server stores ciphertext and `HMAC-SHA256(pepper, authKey)`, never the password.
- **Files are write-once.** Uploads use a conditional write, so an existing file cannot be overwritten.

### Rate Limiting Logic

Two separate counters enforce the daily paste limit and the wrong-password limit.

```mermaid
flowchart TD
    ACTION{Action type}
    ACTION -->|Create paste| DAILY[Check daily counter]
    ACTION -->|Unlock paste| UNLOCK[Check unlock counter]

    DAILY --> HASH_D[Hash: rl#network#YYYYMMDD]
    HASH_D --> GET_D[Get counter from DynamoDB]
    GET_D --> CMP_D{Count < DAILY_PASTE_LIMIT?}
    CMP_D -->|Yes| INCR_D[Increment counter]
    CMP_D -->|No| REJECT_D[Reject: 429 Too Many Requests]
    INCR_D --> ALLOW_D[Allow request]

    UNLOCK --> HASH_U[Hash: ul#network#15min-window]
    HASH_U --> GET_U[Get counter from DynamoDB]
    GET_U --> INCR_U[Increment counter immediately]
    INCR_U --> CMP_U{Count > UNLOCK_MAX_ATTEMPTS?}
    CMP_U -->|Yes| REJECT_U[Reject: 429 Too Many Requests]
    CMP_U -->|No| CHECK_PW[Check password]
    CHECK_PW --> PW_OK{Password correct?}
    PW_OK -->|Yes| REFUND[Refund one attempt]
    PW_OK -->|No| REMAIN[Counter stays incremented]
    REFUND --> ALLOW_U[Return ciphertext]
    REMAIN --> REJECT_PW[Reject: 401 Unauthorized]
```

### Password Verification Flow

The server never sees the password or the encryption key. It stores and checks a keyed hash of the authentication key.

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant DB as DynamoDB

    Note over Client: User enters password
    Client->>Client: Derive authKey from password
    Client->>API: POST /paste/{slug}/unlock (authKey)
    API->>DB: Load paste
    DB-->>API: Stored HMAC(pepper, authKey)
    API->>API: Compute HMAC(pepper, received authKey)
    API->>API: Constant-time comparison
    alt Match
        API-->>Client: Ciphertext
    else No match
        API-->>Client: 401 Unauthorized
    end
```

## Who Is the Visitor?

Rate limits depend on the visitor's network address. `security/visitor.mjs` determines it as follows:

- If the request came directly from a visitor, the address is the visitor's own address.
- If the API hostname is proxied through Cloudflare, the connection comes from a Cloudflare server. In that case `visitor.mjs` reads the real address from the `cf-connecting-ip` header, but **only when the connection comes from one of Cloudflare's published IP ranges**. A client that bypasses Cloudflare and calls API Gateway directly is counted by its own address, so forging the header has no effect.

**Current deployment:** `terraform/10-API-cloudflare.tf` creates the API DNS record with `proxied = false`. Visitors therefore connect to API Gateway directly, and the proxy path is inactive. Enabling the proxy requires changing that record to `proxied = true`, which also places Cloudflare's network in front of the API. Cloudflare's ranges are listed at https://www.cloudflare.com/ips and are hardcoded in `visitor.mjs`. Review them periodically.

### Visitor IP Determination

The API uses the connection's source IP unless it came from Cloudflare, in which case it trusts the forwarded header.

```mermaid
flowchart TD
    START[Request arrives] --> SOURCE[Extract sourceIp from event]
    SOURCE --> HEADER[Read cf-connecting-ip header]
    HEADER --> CHECK{Is sourceIp in Cloudflare ranges?}
    CHECK -->|Yes| TRUST[Use cf-connecting-ip as visitor IP]
    CHECK -->|No| USE[Use sourceIp as visitor IP]
    TRUST --> HASH[Hash visitor IP + pepper]
    USE --> HASH
    HASH --> NETWORK{IPv6?}
    NETWORK -->|Yes| PREFIX[Use /64 prefix]
    NETWORK -->|No| FULL[Use full address]
    PREFIX --> ID[Network identifier for rate limits]
    FULL --> ID
```

### File Upload Flow

Files are uploaded one at a time after the paste is created. Each file index can be written once.

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant DB as DynamoDB
    participant S3

    Client->>API: PUT /paste/{slug}/file/{index} (raw bytes)
    API->>DB: Load paste
    alt Paste not found or expired
        API-->>Client: 404 Not Found
    else Index out of range
        API-->>Client: 400 Bad Request
    else Size mismatch
        API-->>Client: 400 Bad Request
    else All checks pass
        API->>S3: PutObject with IfNoneMatch: *
        alt File already exists
            S3-->>API: PreconditionFailed
            API-->>Client: 409 Conflict
        else Upload succeeds
            S3-->>API: Success
            API-->>Client: 204 No Content
        end
    end
```

### File Download Flow

Public paste files are downloaded with GET. Private paste files require a POST with the password proof.

```mermaid
flowchart TD
    START[File download request] --> METHOD{Request method}
    METHOD -->|GET| PUBLIC[Public paste path]
    METHOD -->|POST| PRIVATE[Private paste path]

    PUBLIC --> LOAD_PUB[Load paste from DynamoDB]
    LOAD_PUB --> CHECK_VIS{visibility == public?}
    CHECK_VIS -->|No| ERR404_PUB[404 Not Found]
    CHECK_VIS -->|Yes| FETCH_PUB[Fetch file from S3]

    PRIVATE --> LOAD_PRIV[Load paste from DynamoDB]
    LOAD_PRIV --> CHECK_PRIV{visibility == private?}
    CHECK_PRIV -->|No| ERR404_PRIV[404 Not Found]
    CHECK_PRIV -->|Yes| VERIFY[Verify password proof]
    VERIFY --> PW_OK{Proof valid?}
    PW_OK -->|No| ERR401[401 Unauthorized]
    PW_OK -->|Yes| FETCH_PRIV[Fetch file from S3]

    FETCH_PUB --> FOUND_PUB{File exists?}
    FETCH_PRIV --> FOUND_PRIV{File exists?}
    FOUND_PUB -->|No| ERR404_FILE_PUB[404 Not Found]
    FOUND_PRIV -->|No| ERR404_FILE_PRIV[404 Not Found]
    FOUND_PUB -->|Yes| RETURN_PUB[Return file bytes]
    FOUND_PRIV -->|Yes| RETURN_PRIV[Return file bytes]
```

## Tests

```bash
npm install     # needed only for the tests; the deployed function has no dependencies
npm test
```

The suite requires Node.js 22 or later. It runs against in-memory fakes for DynamoDB and S3 and needs no AWS credentials. The mock API for the frontend (`frontend/mock/mock-server.ts`) imports this same code, so changes here are reflected in local development.

### Test Architecture

The test suite uses in-memory fakes that implement the same interface as the AWS SDK clients.

```mermaid
flowchart LR
    TEST[api.test.mjs] --> HANDLER[Lambda handler]
    HANDLER --> DDB_FAKE[In-memory DynamoDB fake]
    HANDLER --> S3_FAKE[In-memory S3 fake]
    DDB_FAKE --> MAP[JavaScript Map]
    S3_FAKE --> MAP2[JavaScript Map]

    subgraph Production
        PROD_HANDLER[Lambda handler] --> REAL_DDB[Real DynamoDB]
        PROD_HANDLER --> REAL_S3[Real S3]
    end
```
