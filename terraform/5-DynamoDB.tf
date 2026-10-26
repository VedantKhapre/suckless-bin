resource "aws_dynamodb_table" "pastes" {
  name         = "${var.project_name}-pastes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "slug"

  attribute {
    name = "slug"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = merge({
    Name = "${var.project_name}-pastes"
  }, local.common_tags)
}