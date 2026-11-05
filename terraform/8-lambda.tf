data "archive_file" "api" {
  type        = "zip"
  source_dir  = "${path.root}/../lambda/src"
  output_path = "${path.root}/lambda.zip"
}

resource "random_password" "auth_pepper" {
  length  = 48
  special = false

  lifecycle {
    ignore_changes = [result]
  }
}

resource "aws_cloudwatch_log_group" "api_lambda" {
  name              = "/aws/lambda/${var.project_name}-api"
  retention_in_days = var.log_retention_days
  tags              = local.common_tags
}

resource "aws_lambda_function" "api" {
  function_name    = "${var.project_name}-api"
  role             = aws_iam_role.api_lambda.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "index.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  timeout          = 10
  memory_size      = var.lambda_memory_mb

  environment {
    variables = {
      TABLE_NAME           = aws_dynamodb_table.pastes.name
      FILES_BUCKET         = aws_s3_bucket.files.bucket
      AUTH_PEPPER          = random_password.auth_pepper.result
      TURNSTILE_SECRET_KEY = var.turnstile_secret_key
      DAILY_PASTE_LIMIT    = tostring(var.daily_paste_limit)
      UNLOCK_MAX_ATTEMPTS    = tostring(var.unlock_max_attempts)
    }
  }

  depends_on = [
    aws_cloudwatch_log_group.api_lambda,
    aws_iam_role_policy_attachment.api_lambda_logs,
  ]

  tags = local.common_tags
}