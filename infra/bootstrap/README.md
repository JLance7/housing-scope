# Deploy HomeScope to AWS

## 1. Bootstrap AWS

Sign in with your AWS operator profile. In `infra/bootstrap`, copy `terraform.tfvars.example` to `terraform.tfvars` and fill it in. For an existing deployment, reuse its state bucket and Terraform state. Run these commands from the repository root.

```powershell
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap plan -out=bootstrap.tfplan
terraform -chdir=infra/bootstrap apply bootstrap.tfplan
terraform -chdir=infra/bootstrap output
```

## 2. Configure GitHub and Google

Create a GitHub environment named `prod` for the default branch. Add the [GitHub Actions variables and secrets](../../docs/env_vars.md).

In Google Cloud, set the authorized redirect URI to `https://PREFIX.auth.REGION.amazoncognito.com/oauth2/idpresponse`. Add test users if the OAuth app is in testing mode.

## 3. Deploy

Push to the default branch. Run **Deploy HomeScope (AWS)** with **plan**, review it, then run **apply**. Open the URL in the run summary.

For a custom domain, set `HOMES_CUSTOM_DOMAIN` and `HOMES_ACM_CERTIFICATE_ARN` using an issued certificate in `us-east-1`. Point your DNS CNAME to the CloudFront distribution hostname.

For email alerts, set `HOMES_ENABLE_FEED_SYNC=true`. After your first Google sign-in, add your user to the Cognito `owners` group, then sign out and back in.
