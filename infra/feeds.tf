variable "rentcast_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "rentcast_markets" {
  type    = string
  default = "New York,NY"
}

variable "listing_feed_url" {
  type        = string
  description = "Authorized listing JSON feed URL."
  default     = ""
}

variable "listing_feed_token" {
  sensitive   = true
  type        = string
  description = "Feed bearer token; supplied via TF_VAR_listing_feed_token."
  default     = ""
}

variable "enable_feed_sync" {
  type        = bool
  description = "Enable daily sync only after configuring an authorized feed."
  default     = false
}


variable "alert_from" {
  type        = string
  description = "SES verified sender address for listing alerts."
  default     = ""
}

resource "aws_iam_role_policy" "listing_alert_email" {
  count = var.alert_from == "" ? 0 : 1
  role  = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = ["ses:SendEmail"]
      Resource  = "*"
      Condition = { StringEquals = { "ses:FromAddress" = var.alert_from } }
    }]
  })
}
