variable "project_name" {
  type        = string
  description = "The name of the project"
  default     = "suckless-bin"
}

variable "aws_region" {
  type        = string
  description = "The AWS region to deploy to"
  default     = "us-east-1"
}

variable "cloudflare_api_token" {
  type        = string
  description = "The Cloudflare API token"
  # default     = ""
}

variable "cloudflare_zone_id" {
  type        = string
  description = "The Cloudflare zone ID"
  # default     = ""
}

variable "root_domain" {
  type        = string
  description = "The root domain name for the cloudflare DNS record"
  default     = "hivedant.in"
}

variable "domain_name" {
  type        = string
  description = "The domain name for the cloudflare DNS record"
  default     = "sucklessbin.hivedant.in"
}

variable "api_domain_name" {
  type        = string
  description = "Domain for the API"
  default     = "api.sucklessbin.hivedant.in"
}

variable "environment" {
  type        = string
  description = "The environment to deploy to"
  default     = "dev"
}

variable "tags" {
  type        = map(string)
  description = "Applying common tags to resources"
  default     = {}
}

locals {
  default_tags = {
    Project     = var.project_name
    ManagedBy   = "Terraform"
    Environment = var.environment
  }
  common_tags = merge(local.default_tags, var.tags)
}

variable "price_class" {
  type        = string
  description = "The price class for the CloudFront distribution"
  default     = "PriceClass_100"
}

variable "files_retention_days" {
  type    = number
  default = 1
}
