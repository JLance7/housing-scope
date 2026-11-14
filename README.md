# HomeScope

Search rentals and homes by monthly cost, save favorites, and compare neighborhoods.

## Run locally on Windows

1. Install Python 3.11 or 3.12.
2. Run `.\local_run.bat` from the project folder. Open [http://127.0.0.1:8000](http://127.0.0.1:8000).
3. For live listings, copy `.env.example` to `.env`, fill in `RENTCAST_API_KEY` and `RENTCAST_MARKETS`, then restart and click **Refresh listings**. Without a key, you can browse sample listings.

Local data is stored in `data/homescope.db`. Keep `.env` private.

## How the deployed app works

- Guests browse cached Salt Lake City rentals. EventBridge refreshes them once a day at 11:00 UTC using the preview key from GitHub Actions.
- Google sign-in unlocks favorites and private imports. Users connect their own RentCast key under **Settings and alerts**. AWS Parameter Store encrypts the key.
- HomeScope estimates the free balance from the amount entered and requests made here. It asks before potentially billable requests. The [RentCast dashboard](https://app.rentcast.io/app/api) shows the actual bill.
- CloudFront serves the UI from S3 and routes API requests through API Gateway to Lambda. DynamoDB stores listings and account data.

Code lives in `src/api` and `src/web`. See the [architecture diagram](docs/architecture.md) and [AWS deployment guide](infra/bootstrap/README.md).
