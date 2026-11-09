# HomeScope developer notes

## Deployment paths

Use **Terraform and GitHub Actions** for the hosted HomeScope website. The deployment in [infra/](infra/) includes CloudFront, private S3 website hosting, Google sign-in through Cognito, API Gateway, Lambda, on-demand DynamoDB, and EventBridge. The [bootstrap](bootstrap/) creates the AWS deploy role and state configuration.

## Run locally (Windows)
1. Install Python 3.11 or 3.12 for Windows. Python 3.8 cannot install the pinned Uvicorn release.
2. Double-click `run.bat` to create `.venv`, install dependencies, and start the app at http://127.0.0.1:8000. If the launcher cannot find Python, pass its full path as the first argument.
3. New York opens by default with sample listings. Use **Add a city** to add a city to this browser's picker. Import an authorized CSV containing a `city` column (or the existing `area` column) that matches the city name, or sync an authorized feed. Adding a city alone does not fetch listings.

## Daily online listings with RentCast

[Housing listings ETL diagram (PNG)](docs/listings-etl-architecture.png)

### AWS function permissions

When enabled, EventBridge invokes the ETL Lambda every hour. It imports listings at 11:00 UTC and checks for eligible email watches at each hour. FastAPI handles authenticated manual refreshes by invoking that same function with a manual request. The ETL function chooses the appropriate request budget. Email checks use stored results from scheduled imports and do not call RentCast.

- The web Lambda can read and write application records in DynamoDB, manage authorized Cognito groups, and invoke only the ETL function. It can manage private SNS watch topics and email subscriptions. The web Lambda has no SNS publish permission or listing-provider credentials.
- The ETL Lambda can read and update the listings table and publish matching alerts to private SNS watch topics. It has no Cognito group permissions or public API Gateway route.
- Each Lambda can write to its own CloudWatch log group. The EventBridge rule can invoke only the ETL function.

If the IAM bootstrap is already applied, reapply it locally before running the deployment workflow. The update lets GitHub manage the new ETL role and adds the narrow ETL invoke permission to the runtime boundary.


1. Create a key on the [RentCast Developer plan](https://developers.rentcast.io/reference/getting-started-guide). Copy the local settings template with `Copy-Item .env.example .env` if you do not already have a local settings file.
2. Set `RENTCAST_API_KEY` and set `ADMIN_TOKEN` to a long random value. Leave `RENTCAST_MARKETS="New York,NY"` for the default. Add markets with semicolons, for example `RENTCAST_MARKETS="New York,NY;Chicago,IL"`. Use the same city names in the browser picker.
3. In HomeScope choose a city and click **Get updated listings** for a manual import. Alternatively, run a manual import from the project directory.

```powershell
.\.venv\Scripts\python.exe -m api.sync_listings
```

The ETL allows one automatic RentCast request per UTC day, plus a separate manual budget of one per UTC day and at most 15 in any 32 UTC dates per database. It rotates through markets and sale/rental endpoints and fetches up to 100 active listings per request. With just New York configured, sales and rentals alternate. With more cities each combination refreshes less often. Duplicate triggers on the same day skip the request, including after a failed attempt. The Developer plan includes 50 requests per billing period and charges overages above that. Use a dedicated key for one installation and monitor total account use if you also run another copy or make other API calls. See [RentCast pricing](https://developers.rentcast.io/reference/billing-and-pricing).

HomeScope shows when it fetched a RentCast listing. Results are a sample of provider inventory, and availability can change before the next refresh. Cached RentCast listings older than seven days are hidden from search but remain in Saved if you favorited them. Demo listings are hidden in a city while that city has recent online listings. RentCast does not supply all ownership costs in its listing response.

**Enable locations.** Choose a city, open **Daily updates and email alerts**, and check **Include this city in daily sync**. The location checkbox is off by default. Enable the daily runner as well using either option below. Manual updates have a separate request budget. Manual imports do not send alerts.

**Windows scheduled run.** In Task Scheduler, create a task that runs hourly and set HOMESCOPE_DAILY_ENABLED=true in .env so the UI reflects that configuration. Use the project's `.venv\Scripts\python.exe` as the program, `-m api.sync_listings --scheduled` as arguments, and this project directory as **Start in**. The task loads the local `.env`. The web server can be stopped while the task runs.

**AWS scheduled run.** EventBridge invokes `api.sync_listings.lambda_handler` hourly. The import runs at 11:00 UTC. The remaining invocations check for email deliveries without fetching listings. For Terraform, set `TF_VAR_rentcast_api_key` and optionally `TF_VAR_rentcast_markets`, then set `enable_feed_sync = true`. In GitHub Actions use the `HOMES_RENTCAST_API_KEY` environment secret, set the GitHub variable `HOMES_ENABLE_FEED_SYNC=true`, and use the optional `HOMES_RENTCAST_MARKETS` variable. The API and scheduled job share the on-demand DynamoDB table.

**Email watches.** Save a watch and confirm the email from [Amazon SNS](https://docs.aws.amazon.com/sns/latest/dg/sns-email-notifications.html). The deployed app uses your verified Google email and creates a private topic for that watch. Only confirmed subscriptions receive scheduled matches. A watch can filter by neighborhood or ZIP, maximum monthly cost, keyword, and listing type. Recipients choose a UTC hour. A digest is sent only when a recent scheduled import has new matching listings. Use **Unsubscribe** in HomeScope to remove the watch and topic. Existing email watches from older versions need to be saved again to create their SNS subscriptions. Local testing requires AWS credentials and HOMESCOPE_SNS_TOPIC_PREFIX.

## Data sources
The app does not scrape Zillow or bypass listing access controls. Use an authorized MLS/vendor feed, permitted public API, or CSV export. Set `LISTING_FEED_URL` and optional `LISTING_FEED_TOKEN` in `.env`; the feed must return JSON array or `{ "listings": [...] }` with fields documented in `seed_listings.json`. Import CSV by POSTing `{ "csv": "..." }` to `/api/import`. The sync route accepts `X-Admin-Token` when `ADMIN_TOKEN` is set.

## Browsing and saved locations

Guests can read the listing catalog, available markets, and neighborhood summaries. Sign-in is required for saving city or neighborhood locations, rating a neighborhood, manual refreshes, and account preferences. Each signed-in account has one rating per neighborhood or ZIP and can update it. Public results show only aggregate star ratings and counts. CSV or custom feeds can supply a neighborhood field. RentCast results fall back to an explicitly labeled ZIP when a neighborhood name is unavailable. The manual refresh imports for the selected city; neighborhood and ZIP filters apply to the stored results.

## Monthly affordability
For homes it estimates principal and interest for a 30-year loan at 10% down plus listing taxes, insurance, and HOA. Set `MORTGAGE_RATE` for the assumed annual rate. Apartments use rent plus monthly fees. Estimates are comparisons, not lender quotes.

## AWS website and Google sign-in

[Authentication architecture diagram (PNG)](docs/authentication-architecture.png)

The Terraform deployment serves the website from a private S3 bucket through CloudFront. The same CloudFront URL forwards /api/* to API Gateway without caching those responses. The HTTP API verifies Cognito access tokens for account and write routes. The three explicit public catalog GET routes support guest browsing. The first Google sign-in creates the account. Favorites and email watches are private to that account, and emails go to its verified Google address. Any signed-in user can add online locations and request a manual refresh. Only the owner and approved users can manage automatic schedules or start email watches. Only the owner can grant or revoke that access. Revoking access also stops the recipient’s scheduled emails.

1. Choose a unique Cognito domain prefix and an AWS region. In Google Cloud, create an OAuth client of type **Web application** and add the following **Authorized redirect URI**, replacing the prefix and region with yours.

   https://YOUR-PREFIX.auth.YOUR-REGION.amazoncognito.com/oauth2/idpresponse

   If the Google OAuth app is in Testing, add the intended Google accounts as test users. The Cognito redirect and the CloudFront website have separate roles in this flow. See the [Cognito Google federation guide](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-social-idp.html).

2. Set Terraform auth_domain_prefix and google_client_id, and supply TF_VAR_google_client_secret from your secret store. In GitHub Actions use the HOMES_AUTH_DOMAIN_PREFIX and HOMES_GOOGLE_CLIENT_ID environment variables and the HOMES_GOOGLE_CLIENT_SECRET environment secret. The Google secret is stored in Terraform state, so keep state access restricted.
3. Follow the [local IAM bootstrap and CI/CD steps](bootstrap/README.md) to deploy HomeScope. Open its app_url output to sign in. After your first sign-in, add only your federated user to the **owners** group in the Cognito console and sign out and back in. Use **Manage sync-admin access** on the site to grant or remove access by verified Google email after that person has signed in. Changes apply to newly issued tokens. Existing access tokens expire within 15 minutes.
4. If using the GitHub deployment role, grant it permissions to manage this stack's Cognito, CloudFront, API Gateway HTTP API, and website S3 resources. If upgrading an existing Terraform deployment, review the plan because the previous IP-allowlisted REST API is replaced by the authenticated HTTP API.

Existing shared favorites and email watches are kept in storage. Cloud accounts start with private favorites and watches, and the authenticated deployment sends alerts only for account-owned watches.

## Deploy from GitHub Actions

HomeScope can be the root of its own repository. Follow the [bootstrap guide](bootstrap/README.md) to apply the IAM role locally and configure the GitHub prod environment. The [Deploy HomeScope workflow](.github/workflows/deploy-homescope.yml) builds the Lambda ZIP, signs in to AWS with OIDC, and runs Terraform against the bootstrapped state bucket.
