resource "aws_dynamodb_table" "listings" {
  name         = "${local.name}-listings"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"
  attribute {
    name = "id"
    type = "S"
  }
  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }
}
resource "aws_iam_role" "lambda" {
  name                 = "${local.name}-lambda"
  permissions_boundary = var.runtime_boundary_arn
  assume_role_policy   = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole" }] })
}

resource "aws_iam_role" "etl" {
  name                 = "${local.name}-etl-lambda"
  permissions_boundary = var.runtime_boundary_arn
  assume_role_policy   = aws_iam_role.lambda.assume_role_policy
}

data "aws_partition" "current" {}
data "aws_caller_identity" "current" {}

locals {
  functions = { api = "api.main.handler", sync = "api.sync_listings.lambda_handler" }
  roles     = { api = aws_iam_role.lambda, sync = aws_iam_role.etl }
  sync_name = "${local.name}-sync"
  sync_arn  = "arn:${data.aws_partition.current.partition}:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:${local.sync_name}"
}

resource "aws_iam_role_policy" "logs" {
  for_each = local.functions
  name     = "function-logs"
  role     = local.roles[each.key].name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "${aws_cloudwatch_log_group.lambda[each.key].arn}:*"
    }]
  })
}

resource "aws_iam_role_policy" "storage" {
  role   = aws_iam_role.lambda.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], Resource = aws_dynamodb_table.listings.arn }] })
}

resource "aws_iam_role_policy" "etl_storage" {
  name = "listing-etl-storage"
  role = aws_iam_role.etl.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
      Resource = aws_dynamodb_table.listings.arn
    }]
  })
}

resource "aws_iam_role_policy" "invoke_etl" {
  name = "invoke-listing-etl"
  role = aws_iam_role.lambda.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = local.sync_arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = 14
}
resource "aws_lambda_function" "app" {
  for_each         = local.functions
  function_name    = "${local.name}-${each.key}"
  role             = local.roles[each.key].arn
  handler          = each.value
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  s3_bucket        = aws_s3_bucket.artifacts.id
  s3_key           = aws_s3_object.package.key
  source_code_hash = filebase64sha256(var.package_path)
  timeout          = each.key == "sync" ? 24 : 30
  memory_size      = 512
  environment {
    variables = merge({
      DYNAMODB_TABLE             = aws_dynamodb_table.listings.name
      RENTCAST_MARKETS           = var.rentcast_markets
      HOMESCOPE_SNS_TOPIC_PREFIX = local.alert_topic_prefix
      HOMESCOPE_AUTH_REQUIRED    = "true"
      }, each.key == "api" ? tomap({
        HOMESCOPE_DAILY_ENABLED    = tostring(var.enable_feed_sync)
        HOMESCOPE_RENTCAST_ENABLED = tostring(nonsensitive(length(trimspace(var.rentcast_api_key)) > 0))
        HOMESCOPE_COGNITO_ORIGIN   = local.cognito_origin
        HOMESCOPE_USER_POOL_ID     = aws_cognito_user_pool.accounts.id
        HOMESCOPE_SYNC_FUNCTION    = local.sync_name
        }) : tomap({
        RENTCAST_API_KEY            = var.rentcast_api_key
        LISTING_FEED_URL            = var.listing_feed_url
        LISTING_FEED_TOKEN          = var.listing_feed_token
        HOMESCOPE_SCHEDULE_RULE_ARN = aws_cloudwatch_event_rule.sync.arn
    }))
  }
  depends_on = [
    aws_iam_role_policy.logs,
    aws_iam_role_policy.storage,
    aws_iam_role_policy.etl_storage,
    aws_iam_role_policy.invoke_etl,
    aws_iam_role_policy.watch_topics,
    aws_iam_role_policy.publish_alerts,
  ]
}
resource "aws_cloudwatch_event_rule" "sync" {
  name                = "${local.name}-sync"
  schedule_expression = "cron(0 11 * * ? *)"
  state               = var.enable_feed_sync ? "ENABLED" : "DISABLED"
}
resource "aws_cloudwatch_event_target" "sync" {
  rule = aws_cloudwatch_event_rule.sync.name
  arn  = aws_lambda_function.app["sync"].arn
}
resource "aws_lambda_permission" "sync" {
  statement_id  = "EventBridgeSync"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app["sync"].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.sync.arn
}
