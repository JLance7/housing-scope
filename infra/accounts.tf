variable "auth_domain_prefix" {
  type        = string
  description = "Globally unique lowercase Cognito domain prefix used in the Google OAuth redirect URI."
  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$", var.auth_domain_prefix))
    error_message = "Use 3 to 63 lowercase letters, digits, or interior hyphens."
  }
}

variable "google_client_id" {
  type        = string
  description = "Google OAuth Web application client ID."
  validation {
    condition     = endswith(var.google_client_id, ".apps.googleusercontent.com")
    error_message = "Provide a Google OAuth Web application client ID."
  }
}

variable "google_client_secret" {
  type        = string
  sensitive   = true
  description = "Google OAuth Web application client secret, supplied from a secret store."
  validation {
    condition     = length(var.google_client_secret) > 0
    error_message = "Provide the Google OAuth client secret."
  }
}

locals {
  cognito_origin = "https://${var.auth_domain_prefix}.auth.${var.region}.amazoncognito.com"
}

resource "aws_cognito_user_pool" "accounts" {
  name           = "${local.name}-accounts"
  user_pool_tier = "LITE"
  admin_create_user_config {
    allow_admin_create_user_only = true
  }
}

resource "aws_cognito_user_pool_domain" "accounts" {
  domain       = var.auth_domain_prefix
  user_pool_id = aws_cognito_user_pool.accounts.id
}

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.accounts.id
  provider_name = "Google"
  provider_type = "Google"
  provider_details = {
    client_id        = var.google_client_id
    client_secret    = var.google_client_secret
    authorize_scopes = "openid email profile"
  }
  attribute_mapping = {
    email          = "email"
    email_verified = "email_verified"
  }
}

resource "aws_cognito_user_pool_client" "website" {
  name                                 = "HomeScopeWebsite"
  user_pool_id                         = aws_cognito_user_pool.accounts.id
  generate_secret                      = false
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email"]
  supported_identity_providers         = [aws_cognito_identity_provider.google.provider_name]
  callback_urls                        = ["https://${aws_cloudfront_distribution.website.domain_name}/"]
  logout_urls                          = ["https://${aws_cloudfront_distribution.website.domain_name}/"]
  enable_token_revocation              = true
  access_token_validity                = 15
  token_validity_units { access_token = "minutes" }
  prevent_user_existence_errors = "ENABLED"
  explicit_auth_flows           = ["ALLOW_REFRESH_TOKEN_AUTH"]
}

resource "aws_cognito_user_group" "admins" {
  name         = "admins"
  user_pool_id = aws_cognito_user_pool.accounts.id
}

resource "aws_cognito_user_group" "owners" {
  name         = "owners"
  user_pool_id = aws_cognito_user_pool.accounts.id
}

resource "aws_iam_role_policy" "manage_sync_access" {
  role = aws_iam_role.lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["cognito-idp:ListUsers", "cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminRemoveUserFromGroup"]
      Resource = aws_cognito_user_pool.accounts.arn
    }]
  })
}

output "google_oauth_redirect_uri" { value = "${local.cognito_origin}/oauth2/idpresponse" }
output "user_pool_id" { value = aws_cognito_user_pool.accounts.id }

