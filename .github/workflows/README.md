# CI/CD Workflows

This directory contains the GitHub Actions workflows for sucklessbin. They deploy the infrastructure and the frontend; there is no separate test workflow (run `npm test` in `lambda/` and `bun run astro check` in `frontend/` locally).

All AWS access uses OIDC federation (`id-token: write` and `aws-actions/configure-aws-credentials`) — no long-lived AWS keys are stored in GitHub. Jobs that mutate infrastructure run in the `production` GitHub environment.

## Workflows at a glance

| Workflow | Trigger | What it does |
|---|---|---|
| [`terraform.yaml`](terraform.yaml) (Terraform Workflow) | push to `main` touching `terraform/**.tf`, `*.tfvars`, the lock file, `terraform/functions/**`, or `lambda/**`; manual dispatch | `terraform plan`, then applies the saved plan |
| [`frontend.yaml`](frontend.yaml) (Frontend Workflow) | push to `main` touching `frontend/**`; manual dispatch; automatically after a successful Terraform Workflow run on `main` | `astro check`, build, sync to S3, invalidate CloudFront |
| [`terraform-destroy.yaml`](terraform-destroy.yaml) (Terraform Destroy) | manual dispatch only | tears down all Terraform-managed infrastructure |

## Terraform Workflow

Deploys everything in `terraform/`, including the Lambda function. `lambda/**` is a watched path because `lambda.zip` is built by Terraform's `archive_file` data source — Lambda changes ship through this workflow, not through a separate deploy.

**Triggers**

- `push` to `main` when any of these change: `terraform/**.tf`, `terraform/**.tfvars`, `terraform/.terraform.lock.hcl`, `terraform/functions/**`, `lambda/**`
- `workflow_dispatch`

**Concurrency:** group `terraform`, `cancel-in-progress: false` — runs are serialized and never cancelled mid-apply.

**Jobs**

1. **terraform-plan** (`environment: production`)
   - configures AWS credentials (`secrets.AWS_ROLE_ARN`), sets up Terraform
   - `terraform init -input=false`
   - `terraform fmt -check` (informational; does not fail the job)
   - `terraform validate -no-color`
   - `terraform plan -no-color -input=false -out=tfplan`
   - uploads the `terraform-plan` artifact: `terraform/tfplan` and `terraform/lambda.zip` (2-day retention)
2. **terraform-apply** (`needs: terraform-plan`, `environment: production`)
   - re-initializes, downloads the `terraform-plan` artifact
   - `terraform apply -input=false -auto-approve tfplan` — applies the exact saved plan, does not re-plan

Cloudflare variables are passed as `TF_VAR_*` environment variables: `TF_VAR_cloudflare_api_token`, `TF_VAR_cloudflare_zone_id`, `TF_VAR_turnstile_secret_key`.

Apply is **not** manual — it runs automatically once the plan succeeds, gated by the `production` environment (add required reviewers there if you want an approval gate).

## Frontend Workflow

Builds the Astro site and deploys it to the private S3 bucket behind CloudFront.

**Triggers**

- `push` to `main` touching `frontend/**`
- `workflow_dispatch`
- `workflow_run`: after **Terraform Workflow** completes on `main`; skipped unless the Terraform run succeeded

**Jobs**

1. **check-and-build**
   - Bun setup, `bun install --frozen-lockfile`
   - `bun run astro check`
   - `bun run build` with `PUBLIC_TURNSTILE_SITE_KEY` (from `secrets.TURNSTILE_SITE_KEY`) and `PUBLIC_API_URL` (from `secrets.API_URL`)
   - uploads the `frontend-build` artifact: `frontend/dist/` (2-day retention)
2. **deploy-frontend** (`needs: check-and-build`, `environment: production`)
   - configures AWS credentials, sets up Terraform, `terraform init`
   - reads `frontend_bucket` and `cloudfront_distribution_id` from `terraform output -raw`
   - downloads the build artifact
   - syncs `dist/_astro` with `Cache-Control: public, immutable, max-age=31536000`
   - syncs the rest of `dist` with `--delete` and `Cache-Control: public, max-age=0, must-revalidate` (fingerprinted assets are cached forever; HTML is always revalidated)
   - invalidates CloudFront (`/*`)

## Terraform Destroy

Manual emergency teardown. **Triggers:** `workflow_dispatch` only, with a required `confirm` input — the job runs only when it is exactly `destroy`.

**Job: terraform-destroy** (`environment: production`)

- verifies the state is not empty (`terraform state list` must list at least one resource)
- `terraform destroy -input=false -auto-approve`
- same concurrency group (`terraform`) and `TF_VAR_*` secrets as the apply workflow

## Secrets used

| Secret | Used by | Purpose |
|---|---|---|
| `AWS_ROLE_ARN` | all workflows | IAM role assumed via OIDC |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `TURNSTILE_SECRET_KEY` | Terraform workflows | passed as `TF_VAR_*` |
| `TURNSTILE_SITE_KEY` | Frontend workflow | build-time public Turnstile site key |
| `API_URL` | Frontend workflow | build-time public API base URL |