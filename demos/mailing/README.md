# Capsule Demo — SES Transactional Mailing

This demo shows how to send outbound transactional emails via SMTP injection in Capsule.

When you configure SES for a project in Capsule, Capsule automatically injects high-delivery AWS SES SMTP credentials directly as environment variables into your running container or serverless environment.

## How to Test

1. Run the test script locally by providing the standard SES credentials:
   ```bash
   export SES_SMTP_HOST="email-smtp.us-east-1.amazonaws.com"
   export SES_SMTP_PORT="587"
   export SES_SMTP_USER="your-smtp-username"
   export SES_SMTP_PASSWORD="your-smtp-password"
   export SES_SMTP_FROM="verified-sender@domain.com"
   
   go run send.go destination-email@domain.com
   ```

2. When deployed on Capsule, these variables are **automatically** managed and injected by the PaaS infrastructure. Your code simply reads `os.Getenv("SES_SMTP_HOST")`, etc., and starts sending immediately!
