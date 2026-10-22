resource "aws_acm_certificate" "frontend" {
  provider          = aws.us_east_1
  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = merge({
    Name = "${var.project_name}-certificate"
  }, local.common_tags)
}

resource "cloudflare_dns_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.frontend.domain_validation_options :
    dvo.domain_name => {
      name  = trimsuffix(dvo.resource_record_name, ".")
      type  = dvo.resource_record_type
      value = trimsuffix(dvo.resource_record_value, ".")
    }
  }

  zone_id = var.cloudflare_zone_id
  name    = each.value.name
  type    = each.value.type
  content = each.value.value
  ttl     = 1
  proxied = false
}

resource "aws_acm_certificate_validation" "frontend" {
  provider        = aws.us_east_1
  certificate_arn = aws_acm_certificate.frontend.arn
  validation_record_fqdns = [
    for dvo in aws_acm_certificate.frontend.domain_validation_options :
    dvo.resource_record_name
  ]

  depends_on = [
    cloudflare_dns_record.cert_validation,
    cloudflare_dns_record.caa_amazon,
  ]
}

resource "cloudflare_dns_record" "frontend" {
  zone_id = var.cloudflare_zone_id
  name    = var.domain_name
  type    = "CNAME"
  content = aws_cloudfront_distribution.frontend.domain_name
  ttl     = 1
  proxied = false
}

resource "cloudflare_dns_record" "caa_amazon" {
  zone_id = var.cloudflare_zone_id
  name    = var.root_domain
  type    = "CAA"
  ttl     = 1

  data = {
    flags = 0
    tag   = "issue"
    value = "amazon.com"
  }
}