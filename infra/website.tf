resource "aws_s3_bucket" "website" {
  bucket_prefix = "${substr(local.name, 0, 20)}-website-"
}

resource "aws_s3_bucket_public_access_block" "website" {
  bucket                  = aws_s3_bucket.website.id
  block_public_acls       = true
  ignore_public_acls      = true
  block_public_policy     = true
  restrict_public_buckets = true
}

resource "aws_cloudfront_origin_access_control" "website" {
  name                              = "${local.name}-website"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

locals {
  custom_domain_enabled = var.acm_certificate_arn != ""
  default_website_url   = "https://${aws_cloudfront_distribution.website.domain_name}/"
  website_url           = local.custom_domain_enabled ? "https://${var.custom_domain_name}/" : local.default_website_url
  website_auth_urls     = distinct([local.default_website_url, local.website_url])

  # AWS-managed CloudFront policy IDs are fixed. Use them directly so planning
  # does not require permission to list or read managed policies.
  cloudfront_static_cache_policy = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  cloudfront_api_cache_policy    = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"
  cloudfront_api_origin_policy   = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
}

resource "aws_cloudfront_response_headers_policy" "website" {
  name = "${local.name}-website"
  security_headers_config {
    content_type_options { override = true }
    frame_options {
      frame_option = "DENY"
      override     = true
    }
    referrer_policy {
      referrer_policy = "no-referrer"
      override        = true
    }
    content_security_policy {
      content_security_policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ${local.cognito_origin}; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
      override                = true
    }
  }
}

resource "aws_cloudfront_distribution" "website" {
  enabled             = true
  default_root_object = "index.html"
  aliases             = local.custom_domain_enabled ? [var.custom_domain_name] : []
  price_class         = "PriceClass_100"

  origin {
    domain_name              = aws_s3_bucket.website.bucket_regional_domain_name
    origin_id                = "website"
    origin_access_control_id = aws_cloudfront_origin_access_control.website.id
  }

  origin {
    domain_name = trimprefix(aws_apigatewayv2_api.website.api_endpoint, "https://")
    origin_id   = "api"
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "website"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = local.cloudfront_static_cache_policy
    response_headers_policy_id = aws_cloudfront_response_headers_policy.website.id
    compress                   = true
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = local.cloudfront_api_cache_policy
    origin_request_policy_id = local.cloudfront_api_origin_policy
    compress                 = true
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }
  viewer_certificate {
    cloudfront_default_certificate = !local.custom_domain_enabled
    acm_certificate_arn            = local.custom_domain_enabled ? var.acm_certificate_arn : null
    ssl_support_method             = local.custom_domain_enabled ? "sni-only" : null
    minimum_protocol_version       = local.custom_domain_enabled ? "TLSv1.2_2021" : null
  }
}

resource "aws_s3_bucket_policy" "website" {
  bucket     = aws_s3_bucket.website.id
  depends_on = [aws_s3_bucket_public_access_block.website]
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.website.arn}/*"
      Condition = { StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.website.arn } }
    }]
  })
}

resource "aws_s3_object" "website" {
  for_each = {
    "index.html" = "text/html; charset=utf-8"
    "styles.css" = "text/css; charset=utf-8"
    "app.js"     = "text/javascript; charset=utf-8"
    "auth.js"    = "text/javascript; charset=utf-8"
  }
  bucket        = aws_s3_bucket.website.id
  key           = each.key
  source        = "${path.module}/../web/${each.key}"
  source_hash   = filemd5("${path.module}/../web/${each.key}")
  content_type  = each.value
  cache_control = "public, max-age=60"
}

resource "aws_s3_object" "auth_config" {
  bucket        = aws_s3_bucket.website.id
  key           = "auth-config.js"
  content       = "window.HOMESCOPE_AUTH = ${jsonencode({ origin = local.cognito_origin, clientId = aws_cognito_user_pool_client.website.id })};"
  content_type  = "text/javascript; charset=utf-8"
  cache_control = "public, max-age=60"
}

