# GitHub Actions configuration

In the GitHub repository, go to **Settings → Environments → prod**. Add these under **Environment variables** and **Environment secrets**.

## Required variables

| Name | Value |
| --- | --- |
| `HOMES_DEPLOY_ROLE_ARN` | Terraform bootstrap output `deploy_role_arn` |
| `HOMES_RUNTIME_BOUNDARY_ARN` | Terraform bootstrap output `runtime_boundary_arn` |
| `HOMES_TF_STATE_BUCKET` | Terraform bootstrap output `state_bucket` |
| `HOMES_AUTH_DOMAIN_PREFIX` | Unique Cognito domain prefix |
| `HOMES_GOOGLE_CLIENT_ID` | Google OAuth web client ID |

## Secrets

| Name | Value |
| --- | --- |
| `HOMES_GOOGLE_CLIENT_SECRET` | Google OAuth web client secret. Required. |
| `HOMES_RENTCAST_API_KEY` | RentCast key for the daily Salt Lake City preview. Optional. The preview shows sample listings until live listings are available. |

## Optional variables

| Name | Value |
| --- | --- |
| `AWS_REGION` | Match the bootstrap region. Defaults to `us-east-2`. |
| `HOMES_RENTCAST_MARKETS` | Initial city list for signed-in searches. Defaults to `Salt Lake City,UT`. Separate cities with semicolons. |
| `HOMES_ENABLE_FEED_SYNC` | Set to `true` to enable email alert checks. Defaults to `false`. |
| `HOMES_CUSTOM_DOMAIN` | Website hostname. Defaults to `homescope.joshualanctot.com` when a certificate is configured. |
| `HOMES_ACM_CERTIFICATE_ARN` | Issued ACM certificate in `us-east-1` for the custom hostname. Leave blank to use the CloudFront URL. |

GitHub Actions signs in to AWS through OIDC. It uses the deploy role ARN above.
