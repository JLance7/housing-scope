# HomeScope — city affordability search

A full-stack listings dashboard for cities you choose. FastAPI serves the browser app and provides filtering, monthly ownership-cost estimates, saved listings, CSV import, and a secured feed-sync endpoint. SQLite persists local changes. AWS SAM deploys API Gateway + Lambda + on-demand DynamoDB and a daily EventBridge sync.

## Run locally (Windows)
1. Install Python 3.11 or 3.12 for Windows. Python 3.8 cannot install the pinned Uvicorn release.
2. Double-click `run.bat` to create `.venv`, install dependencies, and start the app at http://127.0.0.1:8000. If the launcher cannot find Python, pass its full path as the first argument.
3. New York opens by default with sample listings. Use **Add a city** to add a city to this browser's picker. Import an authorized CSV containing a `city` column (or the existing `area` column) that matches the city name, or sync an authorized feed. Adding a city alone does not fetch listings.

## Daily online listings with RentCast

1. Create a key on the [RentCast Developer plan](https://developers.rentcast.io/reference/getting-started-guide). Copy the local settings template with `Copy-Item .env.example .env` if you do not already have a local settings file.
2. Set `RENTCAST_API_KEY` and set `ADMIN_TOKEN` to a long random value. Leave `RENTCAST_MARKETS="New York,NY"` for the default. Add markets with semicolons, for example `RENTCAST_MARKETS="New York,NY;Chicago,IL"`. Use the same city names in the browser picker.
3. In HomeScope choose a city and click **Get updated listings** for a manual import. Alternatively, run a manual import from the project directory.

```powershell
.\.venv\Scripts\python.exe -m api.sync_listings
```

The ETL allows one automatic RentCast request per UTC day, plus a separate manual budget of one per UTC day and at most 15 in any 32 UTC dates per database. It rotates through markets and sale/rental endpoints and fetches up to 100 active listings per request. With just New York configured, sales and rentals alternate. With more cities each combination refreshes less often. Duplicate triggers on the same day skip the request, including after a failed attempt. The Developer plan includes 50 requests per billing period and charges overages above that. Use a dedicated key for one installation and monitor total account use if you also run another copy or make other API calls. See [RentCast pricing](https://developers.rentcast.io/reference/billing-and-pricing).

HomeScope shows when it fetched a RentCast listing. Results are a sample of provider inventory, and availability can change before the next refresh. Cached RentCast listings older than seven days are hidden from search but remain in Saved if you favorited them. Demo listings are hidden in a city while that city has recent online listings. RentCast does not supply all ownership costs in its listing response.

**Enable locations.** Choose a city, open **Daily updates and email alerts**, and check **Include this city in daily sync**. The location checkbox is off by default. Enable the daily runner as well using either option below. Manual updates have a separate request budget. Manual imports do not send alerts.

**Windows daily run.** In Task Scheduler, create a Daily task and set HOMESCOPE_DAILY_ENABLED=true in .env so the UI reflects that configuration. Use the project's `.venv\Scripts\python.exe` as the program, `-m api.sync_listings --scheduled` as arguments, and this project directory as **Start in**. The task loads the local `.env`. The web server can be stopped while the task runs.

**AWS daily run.** EventBridge invokes `api.sync_listings.lambda_handler` at 11:00 UTC daily. For Terraform, set `TF_VAR_rentcast_api_key` and optionally `TF_VAR_rentcast_markets`, then set `enable_feed_sync = true`. In GitHub Actions use the `HOMES_RENTCAST_API_KEY` environment secret, set the GitHub variable `HOMES_ENABLE_FEED_SYNC=true`, and use the optional `HOMES_RENTCAST_MARKETS` variable. For SAM, configure RENTCAST_API_KEY and RENTCAST_MARKETS on both Lambda functions after deploying. Set ADMIN_TOKEN on the API function. Both use the same on-demand DynamoDB table.

**Email watches.** Verify a sender identity in [Amazon SES](https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html). In the SES sandbox, verify each recipient as well. Set HOMESCOPE_ALERT_FROM in local .env and configure AWS credentials and a region, or set Terraform TF_VAR_alert_from, GitHub's HOMES_ALERT_FROM variable, or the SAM AlertFrom parameter. Use **Subscribe or update** with your own email address and a maximum estimated monthly cost, address keyword, or listing type. When you specify multiple criteria, a listing must match them all. The scheduled job sends a digest of newly matched listings per watch. **Unsubscribe** removes the watch for that email and city. A watch is shared server configuration protected by the admin token.

## Data sources
The app does not scrape Zillow or bypass listing access controls. Use an authorized MLS/vendor feed, permitted public API, or CSV export. Set `LISTING_FEED_URL` and optional `LISTING_FEED_TOKEN` in `.env`; the feed must return JSON array or `{ "listings": [...] }` with fields documented in `seed_listings.json`. Import CSV by POSTing `{ "csv": "..." }` to `/api/import`. The sync route accepts `X-Admin-Token` when `ADMIN_TOKEN` is set.

## Monthly affordability
For homes it estimates principal and interest for a 30-year loan at 10% down plus listing taxes, insurance, and HOA. Set `MORTGAGE_RATE` for the assumed annual rate. Apartments use rent plus monthly fees. Estimates are comparisons, not lender quotes.

## AWS website and Google sign-in

The Terraform deployment serves the website from a private S3 bucket through CloudFront. The same CloudFront URL forwards /api/* to API Gateway without caching those responses. The HTTP API verifies Cognito access tokens. The first Google sign-in creates the account. Favorites and email watches are private to that account, and emails go to its verified Google address. Any signed-in user can add online locations and request a manual refresh. Only the owner and approved users can manage automatic schedules or start email watches. Only the owner can grant or revoke that access. Revoking access also stops the recipient’s scheduled emails.

1. Choose a unique Cognito domain prefix and an AWS region. In Google Cloud, create an OAuth client of type **Web application** and add the following **Authorized redirect URI**, replacing the prefix and region with yours.

   https://YOUR-PREFIX.auth.YOUR-REGION.amazoncognito.com/oauth2/idpresponse

   If the Google OAuth app is in Testing, add the intended Google accounts as test users. The Cognito redirect and the CloudFront website have separate roles in this flow. See the [Cognito Google federation guide](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-social-idp.html).

2. Set Terraform auth_domain_prefix and google_client_id, and supply TF_VAR_google_client_secret from your secret store. In GitHub Actions use the HOMES_AUTH_DOMAIN_PREFIX and HOMES_GOOGLE_CLIENT_ID environment variables and the HOMES_GOOGLE_CLIENT_SECRET environment secret. The Google secret is stored in Terraform state, so keep state access restricted.
3. Follow the [local IAM bootstrap and CI/CD steps](bootstrap/README.md) to deploy HomeScope. Open its app_url output to sign in. After your first sign-in, add only your federated user to the **owners** group in the Cognito console and sign out and back in. Use **Manage sync-admin access** on the site to grant or remove access by verified Google email after that person has signed in. Changes apply to newly issued tokens. Existing access tokens expire within 15 minutes.
4. If using the GitHub deployment role, grant it permissions to manage this stack's Cognito, CloudFront, API Gateway HTTP API, and website S3 resources. If upgrading an existing Terraform deployment, review the plan because the previous IP-allowlisted REST API is replaced by the authenticated HTTP API.

Existing shared favorites and email watches are kept in storage. Cloud accounts start with private favorites and watches, and the authenticated deployment sends alerts only for account-owned watches.

## Legacy local-style SAM deployment
Install AWS SAM CLI, configure AWS credentials, then build from a clean staging folder that excludes local settings and data.

```powershell
$stage = Join-Path ([IO.Path]::GetTempPath()) ("homescope-sam-" + [guid]::NewGuid())
New-Item -ItemType Directory $stage | Out-Null
Copy-Item api,web -Destination $stage -Recurse
Copy-Item requirements.txt,seed_listings.json,template.yaml -Destination $stage
Push-Location $stage
sam build
sam deploy --guided
Pop-Location
```

 The SAM package includes `web/` so the Lambda can serve the UI alongside the API. The template creates on-demand DynamoDB storage, API Gateway, Lambda, and a daily scheduled sync. Set feed secrets in Lambda environment configuration before enabling feed ingestion. Low traffic has no provisioned DB/server cost; API calls, Lambda, and stored data are billed by use. Review AWS pricing and add an authorized feed before public use.

## Terraform and GitHub Actions (preferred cloud path)

The `infra/` directory now contains the cloud resources for this application. Build/package/test and manual OIDC deployment workflows live at the bundle's `.github/workflows/`. Follow [DEPLOYMENT.md](../DEPLOYMENT.md) for complete state/bootstrap, account permissions, variables/secrets and deployment commands. The bundle must be the GitHub repository root for shared module/workflow paths to work. Local run.bat remains supported.
