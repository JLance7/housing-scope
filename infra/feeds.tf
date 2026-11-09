variable "rentcast_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "rentcast_markets" {
  type    = string
  default = "White Plains,NY"
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
  description = "Enable the hourly job for the daily import and per-watch email delivery."
  default     = false
}



locals {
  alert_topic_prefix = "${local.name}-watch-"
  alert_topics_arn   = "arn:${data.aws_partition.current.partition}:sns:${var.region}:${data.aws_caller_identity.current.account_id}:${local.alert_topic_prefix}*"
}

resource "aws_iam_role_policy" "watch_topics" {
  name = "manage-listing-email-watches"
  role = aws_iam_role.lambda.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["sns:CreateTopic", "sns:GetTopicAttributes", "sns:DeleteTopic"], Resource = local.alert_topics_arn },
      { Effect = "Allow", Action = ["sns:Subscribe"], Resource = local.alert_topics_arn,
      Condition = { StringEquals = { "sns:Protocol" = "email" } } }
    ]
  })
}

resource "aws_iam_role_policy" "publish_alerts" {
  name = "publish-listing-email-watches"
  role = aws_iam_role.etl.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sns:GetTopicAttributes", "sns:Publish"]
      Resource = local.alert_topics_arn
    }]
  })
}
