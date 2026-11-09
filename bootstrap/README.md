# Bootstrap HomeScope deployment

Run this one-time Terraform stack on your computer with an AWS operator profile. It creates the GitHub OIDC deployer role and the runtime permissions boundary. It can also create a private, encrypted, versioned S3 state bucket. GitHub Actions then deploys the website, Google sign-in, API, DynamoDB, and EventBridge job.

## 1. Apply the bootstrap locally

From the HomeScope repository root in PowerShell:

```powershell
Set-Location .\bootstrap
if (-not (Test-Path terraform.tfvars)) { Copy-Item terraform.tfvars.example terraform.tfvars }
notepad terraform.tfvars
aws sts get-caller-identity
terraform init
terraform plan -out bootstrap.tfplan
terraform apply bootstrap.tfplan
terraform output
```

- Choose a globally unique state bucket. If HomeScope already has Terraform state, reuse the existing bucket by setting create_state_bucket to false. The workflow keeps the state key columbus-homes/prod/terraform.tfstate. For an existing installation, review the first plan for unintended replacements before applying it.
- The deploy role defaults to the immutable GitHub OIDC subject for [JLance7/housing-scope](https://github.com/JLance7/housing-scope), restricted to the production environment. The example already contains that subject. If GitHub is configured to issue a different subject, set github_subject to the exact subject for that same repository and environment.
- Set create_github_oidc_provider to true only if your AWS account does not already have the GitHub OIDC provider. Use the same AWS region in both the bootstrap and the workflow.
- Keep the bootstrap's local state and plan private. The application stack uses the S3 backend and a lock file.

## 2. Configure GitHub Actions

Create a GitHub environment named production. Restrict it to the default branch (currently master) and set these environment variables:

| Variable | Value |
| --- | --- |
| HOMES_DEPLOY_ROLE_ARN | Bootstrap output deploy_role_arn |
| HOMES_RUNTIME_BOUNDARY_ARN | Bootstrap output runtime_boundary_arn |
| HOMES_TF_STATE_BUCKET | Bootstrap output state_bucket |
| AWS_REGION | Bootstrap AWS region. The workflow defaults to us-east-2. |
| HOMES_AUTH_DOMAIN_PREFIX | Unique Cognito domain prefix |
| HOMES_GOOGLE_CLIENT_ID | Google OAuth web client ID |
| HOMES_ENABLE_FEED_SYNC | Set to true when you are ready for daily imports |
| HOMES_RENTCAST_MARKETS | Optional initial city list, for example New York,NY;Chicago,IL |
| HOMES_FEED_URL | Optional URL for a custom listing feed |

Set HOMES_GOOGLE_CLIENT_SECRET as an environment secret. Amazon SNS handles alert delivery, so there is no sender-address variable. Recipients confirm each watch by email. Set HOMES_RENTCAST_API_KEY to enable online listings from RentCast. If you use a custom feed that requires a token, add HOMES_FEED_TOKEN. GitHub uses OIDC for AWS access. Set Google’s authorized callback as described in the [developer notes](../dev-notes.md#aws-website-and-google-sign-in).

Push HomeScope as the repository root, with .github/workflows/deploy-homescope.yml, api, bootstrap, infra, scripts, and web at that root. In Actions, run **Deploy HomeScope (AWS)** with **plan** first. If the plan is correct, run it again with **apply**. GitHub assumes the deployer role with OIDC. The workflow prints the CloudFront website URL after deployment.

## 3. Set your owner access

Sign in with Google once. In the Cognito user pool, add only your account to the owners group, then sign out and back in. Use **Manage sync-admin access** on the site to approve other users after their first Google sign-in. Ordinary signed-in users can add regions and request manual refreshes. Automatic schedules and email watches are for the owner and approved users.

[GitHub OIDC setup](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws) · [IAM permissions boundaries](https://docs.aws.amazon.com/IAM/latest/UserGuide/access_policies_boundaries.html)

