resource "aws_apigatewayv2_api" "website" {
  name          = "${local.name}-http"
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.website.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "HomeScopeAccounts"
  jwt_configuration {
    audience = [aws_cognito_user_pool_client.website.id]
    issuer   = "https://${aws_cognito_user_pool.accounts.endpoint}"
  }
}

resource "aws_apigatewayv2_integration" "website" {
  api_id                 = aws_apigatewayv2_api.website.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.app["api"].invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "api" {
  api_id               = aws_apigatewayv2_api.website.id
  route_key            = "ANY /api/{proxy+}"
  target               = "integrations/${aws_apigatewayv2_integration.website.id}"
  authorization_type   = "JWT"
  authorizer_id        = aws_apigatewayv2_authorizer.cognito.id
  authorization_scopes = ["openid"]
}

resource "aws_apigatewayv2_stage" "website" {
  api_id      = aws_apigatewayv2_api.website.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_burst_limit = 30
    throttling_rate_limit  = 15
  }
}

resource "aws_lambda_permission" "website_api" {
  statement_id  = "AllowHomeScopeHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.app["api"].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.website.execution_arn}/*/*/api/*"
}

output "app_url" { value = "https://${aws_cloudfront_distribution.website.domain_name}/" }
output "api_url" { value = aws_apigatewayv2_api.website.api_endpoint }

