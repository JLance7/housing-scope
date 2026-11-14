terraform {
  required_version = ">= 1.11, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "region" {
  type    = string
  default = "us-east-2"
}

variable "state_bucket" {
  type        = string
  description = "A globally unique S3 bucket for HomeScope Terraform state."
}

variable "create_state_bucket" {
  type        = bool
  default     = true
  description = "Set false to reuse an existing private, versioned state bucket in this region."
}

variable "github_subject" {
  type        = string
  description = "Exact GitHub OIDC subject for this repository's production environment."
  default     = "repo:JLance7@82004410/housing-scope@1450948449:environment:prod"
  validation {
    condition     = can(regex("^repo:[A-Za-z0-9_.@-]+/[A-Za-z0-9_.@-]+:environment:prod$", var.github_subject))
    error_message = "Use the exact repo:OWNER/REPO:environment:prod subject or its immutable-ID equivalent."
  }
}

variable "create_github_oidc_provider" {
  type        = bool
  default     = false
  description = "Set true only if the AWS account does not already have the GitHub OIDC provider."
}

provider "aws" {
  region = var.region
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  name         = "resume-homes-prod"
  partition    = data.aws_partition.current.partition
  account      = data.aws_caller_identity.current.account_id
  regional_arn = "arn:${local.partition}"
  state_key    = "columbus-homes/prod/terraform.tfstate"
  state_arn    = "arn:${local.partition}:s3:::${var.state_bucket}"
  runtime_roles = [
    "arn:${local.partition}:iam::${local.account}:role/${local.name}-lambda",
    "arn:${local.partition}:iam::${local.account}:role/${local.name}-etl-lambda",
  ]
  lambda_arn = "${local.regional_arn}:lambda:${var.region}:${local.account}:function:${local.name}-*"
  table_arn  = "${local.regional_arn}:dynamodb:${var.region}:${local.account}:table/${local.name}-listings"
  logs_arn   = "${local.regional_arn}:logs:${var.region}:${local.account}:log-group:/aws/lambda/${local.name}-*"
  pool_arn   = "${local.regional_arn}:cognito-idp:${var.region}:${local.account}:userpool/*"
  oidc_host  = "token.actions.githubusercontent.com"
  oidc_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : (
    "arn:${local.partition}:iam::${local.account}:oidc-provider/${local.oidc_host}"
  )
}

resource "aws_s3_bucket" "state" {
  count  = var.create_state_bucket ? 1 : 0
  bucket = var.state_bucket
  lifecycle { prevent_destroy = true }
}

resource "aws_s3_bucket_versioning" "state" {
  count  = var.create_state_bucket ? 1 : 0
  bucket = aws_s3_bucket.state[0].id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  count  = var.create_state_bucket ? 1 : 0
  bucket = aws_s3_bucket.state[0].id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  count                   = var.create_state_bucket ? 1 : 0
  bucket                  = aws_s3_bucket.state[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_iam_openid_connect_provider" "github" {
  count          = var.create_github_oidc_provider ? 1 : 0
  url            = "https://${local.oidc_host}"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "deployer" {
  name = "${local.name}-github-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.oidc_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = { StringEquals = {
        "${local.oidc_host}:aud" = "sts.amazonaws.com"
        "${local.oidc_host}:sub" = var.github_subject
      } }
    }]
  })
}

resource "aws_iam_policy" "runtime_boundary" {
  name = "${local.name}-runtime-boundary"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource = local.logs_arn },
      { Effect = "Allow", Action = ["dynamodb:Scan", "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem"], Resource = local.table_arn },
      { Effect = "Allow", Action = ["cognito-idp:ListUsers", "cognito-idp:AdminAddUserToGroup", "cognito-idp:AdminRemoveUserFromGroup"], Resource = local.pool_arn },
      { Effect = "Allow", Action = ["ssm:GetParameter", "ssm:PutParameter", "ssm:DeleteParameter"], Resource = "${local.regional_arn}:ssm:${var.region}:${local.account}:parameter/${local.name}/rentcast/*" },
      { Effect = "Allow", Action = ["sns:CreateTopic", "sns:GetTopicAttributes", "sns:Subscribe", "sns:DeleteTopic", "sns:Publish"], Resource = "${local.regional_arn}:sns:${var.region}:${local.account}:${local.name}-watch-*" }
    ]
  })
}

resource "aws_iam_role_policy" "state" {
  name = "homescope-state"
  role = aws_iam_role.deployer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = local.state_arn,
      Condition = { StringLike = { "s3:prefix" = ["columbus-homes/prod", "columbus-homes/prod/*", "env:/", "env:/*"] } } },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${local.state_arn}/${local.state_key}" },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${local.state_arn}/${local.state_key}.tflock" }
    ]
  })
}

resource "aws_iam_role_policy" "runtime_iam" {
  name = "homescope-runtime-iam"
  role = aws_iam_role.deployer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["iam:CreateRole", "iam:PutRolePermissionsBoundary"], Resource = local.runtime_roles,
      Condition = { ArnEquals = { "iam:PermissionsBoundary" = aws_iam_policy.runtime_boundary.arn } } },
      { Effect = "Allow", Action = ["iam:GetRole", "iam:DeleteRole", "iam:UpdateRole", "iam:UpdateAssumeRolePolicy", "iam:TagRole", "iam:UntagRole", "iam:ListRoleTags", "iam:ListRolePolicies", "iam:ListAttachedRolePolicies", "iam:ListInstanceProfilesForRole", "iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy"], Resource = local.runtime_roles },
      { Effect = "Allow", Action = ["iam:AttachRolePolicy", "iam:DetachRolePolicy"], Resource = local.runtime_roles,
      Condition = { ArnEquals = { "iam:PolicyARN" = "arn:${local.partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole" } } },
      { Effect = "Allow", Action = ["iam:PassRole"], Resource = local.runtime_roles,
      Condition = { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } } }
    ]
  })
}

resource "aws_iam_role_policy" "regional" {
  name = "homescope-regional-resources"
  role = aws_iam_role.deployer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["lambda:CreateFunction", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:GetFunctionCodeSigningConfig", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:DeleteFunction", "lambda:ListVersionsByFunction", "lambda:GetPolicy", "lambda:AddPermission", "lambda:RemovePermission", "lambda:ListTags", "lambda:TagResource", "lambda:UntagResource"], Resource = local.lambda_arn },
      { Effect = "Allow", Action = ["dynamodb:CreateTable", "dynamodb:DescribeTable", "dynamodb:UpdateTable", "dynamodb:DeleteTable", "dynamodb:DescribeContinuousBackups", "dynamodb:UpdateContinuousBackups", "dynamodb:DescribeTimeToLive", "dynamodb:ListTagsOfResource", "dynamodb:TagResource", "dynamodb:UntagResource"], Resource = local.table_arn },
      { Effect = "Allow", Action = ["events:PutRule", "events:DescribeRule", "events:EnableRule", "events:DisableRule", "events:DeleteRule", "events:PutTargets", "events:ListTargetsByRule", "events:RemoveTargets", "events:ListTagsForResource", "events:TagResource", "events:UntagResource"], Resource = "${local.regional_arn}:events:${var.region}:${local.account}:rule/${local.name}-sync" },
      { Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy", "logs:TagResource", "logs:UntagResource", "logs:ListTagsForResource", "logs:ListTagsLogGroup"], Resource = local.logs_arn },
      { Effect = "Allow", Action = ["logs:DescribeLogGroups"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = var.region } } },
      { Effect = "Allow", Action = ["apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:PATCH", "apigateway:DELETE", "apigateway:TagResource"], Resource = ["${local.regional_arn}:apigateway:${var.region}::/apis", "${local.regional_arn}:apigateway:${var.region}::/apis/*", "${local.regional_arn}:apigateway:${var.region}::/tags/*"] },
      { Effect = "Allow", Action = ["cognito-idp:CreateUserPool", "cognito-idp:DescribeUserPoolDomain"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = var.region } } },
      { Effect = "Allow", Action = ["cognito-idp:DescribeUserPool", "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:UpdateUserPool", "cognito-idp:DeleteUserPool", "cognito-idp:TagResource", "cognito-idp:UntagResource", "cognito-idp:ListTagsForResource", "cognito-idp:CreateUserPoolDomain", "cognito-idp:UpdateUserPoolDomain", "cognito-idp:DeleteUserPoolDomain", "cognito-idp:CreateIdentityProvider", "cognito-idp:DescribeIdentityProvider", "cognito-idp:UpdateIdentityProvider", "cognito-idp:DeleteIdentityProvider", "cognito-idp:CreateUserPoolClient", "cognito-idp:DescribeUserPoolClient", "cognito-idp:UpdateUserPoolClient", "cognito-idp:DeleteUserPoolClient", "cognito-idp:CreateGroup", "cognito-idp:GetGroup", "cognito-idp:UpdateGroup", "cognito-idp:DeleteGroup"], Resource = local.pool_arn }
    ]
  })
}

resource "aws_iam_role_policy" "website" {
  name = "homescope-website-and-artifacts"
  role = aws_iam_role.deployer.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:CreateBucket", "s3:DeleteBucket", "s3:ListBucket", "s3:ListBucketVersions", "s3:GetBucket*", "s3:GetAccelerateConfiguration", "s3:GetLifecycleConfiguration", "s3:GetReplicationConfiguration", "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration", "s3:PutBucketPublicAccessBlock", "s3:GetBucketPublicAccessBlock", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:PutBucketTagging", "s3:DeleteBucketTagging"], Resource = ["arn:${local.partition}:s3:::${local.name}-artifacts-*", "arn:${local.partition}:s3:::${local.name}-website-*"] },
      { Effect = "Allow", Action = ["s3:GetObject", "s3:GetObjectTagging", "s3:PutObject", "s3:PutObjectTagging", "s3:DeleteObject", "s3:AbortMultipartUpload"], Resource = ["arn:${local.partition}:s3:::${local.name}-artifacts-*/*", "arn:${local.partition}:s3:::${local.name}-website-*/*"] },
      { Effect = "Allow", Action = ["cloudfront:ListCachePolicies", "cloudfront:ListOriginRequestPolicies", "cloudfront:CreateDistribution", "cloudfront:CreateDistributionWithTags", "cloudfront:CreateOriginAccessControl", "cloudfront:CreateResponseHeadersPolicy"], Resource = "*" },
      { Effect = "Allow", Action = ["cloudfront:GetDistribution", "cloudfront:GetDistributionConfig", "cloudfront:UpdateDistribution", "cloudfront:DeleteDistribution", "cloudfront:GetOriginAccessControl", "cloudfront:GetOriginAccessControlConfig", "cloudfront:UpdateOriginAccessControl", "cloudfront:DeleteOriginAccessControl", "cloudfront:GetResponseHeadersPolicy", "cloudfront:GetResponseHeadersPolicyConfig", "cloudfront:UpdateResponseHeadersPolicy", "cloudfront:DeleteResponseHeadersPolicy", "cloudfront:TagResource", "cloudfront:UntagResource", "cloudfront:ListTagsForResource"], Resource = "arn:${local.partition}:cloudfront::${local.account}:*" }
    ]
  })
}

output "deploy_role_arn" { value = aws_iam_role.deployer.arn }
output "runtime_boundary_arn" { value = aws_iam_policy.runtime_boundary.arn }
output "state_bucket" { value = var.state_bucket }

