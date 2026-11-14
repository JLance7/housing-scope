# HomeScope architecture

The public preview and private imports use separate RentCast keys.

```mermaid
flowchart LR
    Browser["Browser"]
    Edge["CloudFront"]
    UI["Private S3 bucket<br/>HomeScope website"]
    Google["Google OAuth"]
    RentCast["RentCast API"]

    subgraph AWS["AWS application"]
        Cognito["Amazon Cognito"]
        Gateway["API Gateway"]
        API["API Lambda<br/>FastAPI"]
        Keys["SSM Parameter Store<br/>User keys encrypted as SecureString"]
        DB["DynamoDB<br/>Public cache, private listings,<br/>favorites and usage"]
        Schedule["EventBridge"]
        Sync["Sync Lambda"]
        SNS["Amazon SNS"]
    end

    Browser --> Edge
    Edge --> UI
    Edge -->|"/api/*"| Gateway
    Browser -->|"Sign in"| Cognito
    Cognito <-->|"Federated sign-in"| Google
    Cognito -.->|"JWT issuer"| Gateway
    Gateway -->|"Guest catalog or authenticated request"| API
    API <-->|"Save and retrieve user key"| Keys
    API <-->|"Read cache and track reservations"| DB
    API -->|"Private refresh with user key<br/>Check quota and require overage consent"| RentCast

    Schedule -->|"Hourly trigger"| Sync
    Sync -->|"One Salt Lake City rental refresh per UTC day"| RentCast
    Sync -->|"Update public cache"| DB
    Sync -->|"Optional listing alerts"| SNS

    Actions["GitHub Actions<br/>Terraform deployment"]
    Actions -.->|"Deploy website and AWS resources"| Edge
    Actions -.->|"Configure preview key from GitHub secret"| Sync
```

- **Guest browsing** reads cached Salt Lake City rentals. The daily import runs at 11:00 UTC.
- **Private refreshes** use the signed-in user's key. HomeScope records request attempts and asks for consent before a potentially billable request.
- **Local development** uses Uvicorn and SQLite. Run `local_run.bat`.
