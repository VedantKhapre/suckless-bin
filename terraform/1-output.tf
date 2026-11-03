output "site_url" {
  value = "https://${var.domain_name}"
}

output "api_url" {
  value = "https://${var.api_domain_name}"
}

output "frontend_bucket" {
  value = aws_s3_bucket.frontend.bucket
}

output "files_bucket" {
  value = aws_s3_bucket.files.bucket
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.frontend.id
}

output "lambda_function_name" {
  value = aws_lambda_function.api.function_name
}

output "pastes_table" {
  value = aws_dynamodb_table.pastes.name
}