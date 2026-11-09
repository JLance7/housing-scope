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
resource "aws_iam_role_policy_attachment" "logs" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}
resource "aws_iam_role_policy" "storage" {
  role   = aws_iam_role.lambda.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Allow", Action = ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], Resource = aws_dynamodb_table.listings.arn }] })
}
locals { functions = { api = "api.main.handler", sync = "api.sync_listings.lambda_handler" } }
resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.functions
  name              = "/aws/lambda/${local.name}-${each.key}"
  retention_in_days = 14
}
resource "aws_lambda_function" "app" {
  for_each         = local.functions
  function_name    = "${local.name}-${each.key}"
  role             = aws_iam_role.lambda.arn
  handler          = each.value
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  s3_bucket        = aws_s3_bucket.artifacts.id
  s3_key           = aws_s3_object.package.key
  source_code_hash = filebase64sha256(var.package_path)
  timeout          = 30
  memory_size      = 512
  environment { variables = {
    DYNAMODB_TABLE           = aws_dynamodb_table.listings.name
    HOMESCOPE_DB             = "/tmp/homescope.db"
    RENTCAST_API_KEY         = var.rentcast_api_key
    RENTCAST_MARKETS         = var.rentcast_markets
    HOMESCOPE_DAILY_ENABLED  = tostring(var.enable_feed_sync)
    HOMESCOPE_ALERT_FROM     = var.alert_from
    LISTING_FEED_URL         = var.listing_feed_url
    LISTING_FEED_TOKEN       = var.listing_feed_token
    HOMESCOPE_AUTH_REQUIRED  = "true"
    HOMESCOPE_COGNITO_ORIGIN = local.cognito_origin
    HOMESCOPE_USER_POOL_ID   = aws_cognito_user_pool.accounts.id
    SYNC_ON_START            = "false"
  } }
  depends_on = [aws_cloudwatch_log_group.lambda, aws_iam_role_policy.storage, aws_iam_role_policy_attachment.logs]
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
