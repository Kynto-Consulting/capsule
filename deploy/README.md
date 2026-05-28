# Capsule Deploy

Terraform modules and production Docker Compose configuration for deploying Capsule to AWS.

---

## What Terraform Provisions

| Resource                  | Purpose                                                           |
|---------------------------|-------------------------------------------------------------------|
| **EC2 instance**          | Runs the backend API and frontend via Docker Compose              |
| **ECR repositories**      | Container registries for backend and frontend images              |
| **S3 bucket (artifacts)** | Stores deployment source archives uploaded by the CLI             |
| **S3 bucket (static)**    | Static asset hosting                                              |
| **Application Load Balancer (ALB)** | HTTPS termination and routing to the EC2 instance       |
| **RDS subnet group**      | Subnet group used when users provision managed databases          |
| **Security groups**       | Least-privilege rules for EC2, ALB, and RDS                      |
| **IAM user + policy**     | API credentials with scoped permissions (ECR, S3, RDS, SES, Bedrock, ALB, Cost Explorer) |
| **EC2 key pair**          | SSH access to the builder/app instance                            |

---

## Prerequisites

- [Terraform](https://developer.hashicorp.com/terraform/install) 1.5+
- [AWS CLI](https://aws.amazon.com/cli/) configured with credentials that have permissions to create the resources above
- An ACM certificate ARN (required if you want HTTPS on the ALB)

---

## Quick Deploy

```bash
cd deploy/terraform

# 1. Initialize Terraform
terraform init

# 2. Review the plan
terraform plan \
  -var="aws_account_id=YOUR_ACCOUNT_ID" \
  -var="alb_domain=api.your-domain.com" \
  -var="alb_certificate_arn=arn:aws:acm:us-east-1:..."

# 3. Apply
terraform apply \
  -var="aws_account_id=YOUR_ACCOUNT_ID" \
  -var="alb_domain=api.your-domain.com" \
  -var="alb_certificate_arn=arn:aws:acm:us-east-1:..."
```

After apply, Terraform prints a `summary` output with all key values you need for the next steps.

---

## Variables

| Variable               | Default        | Required | Description                                                              |
|------------------------|----------------|----------|--------------------------------------------------------------------------|
| `aws_region`           | `us-east-1`    | No       | AWS region to deploy into                                                |
| `aws_account_id`       | —              | Yes      | Your AWS account ID                                                      |
| `environment`          | `production`   | No       | Environment label used in resource naming (e.g. `production`, `staging`) |
| `app_name`             | `capsule`      | No       | Application name prefix for all resource names                           |
| `alb_domain`           | `""`           | No       | Domain for the ALB Route53 alias. Leave empty to skip HTTPS listener.    |
| `alb_certificate_arn`  | `""`           | No*      | ACM certificate ARN for the HTTPS listener. Required when `alb_domain` is set. |
| `db_instance_class`    | `db.t3.micro`  | No       | Default RDS instance class for user-provisioned databases                |
| `ec2_instance_type`    | `t3.small`     | No       | EC2 instance type for the app/builder server                             |
| `key_pair_name`        | `capsule-key`  | No       | Name of the EC2 key pair attached to instances                           |
| `ec2_public_key`       | `""`           | No       | Public key material for key pair creation. Leave empty to import existing.|

---

## Outputs

After a successful `terraform apply`, the `summary` output contains:

| Key                   | Description                                              |
|-----------------------|----------------------------------------------------------|
| `alb_dns_name`        | ALB DNS name — point your domain's CNAME/A record here   |
| `ecr_registry_url`    | ECR registry hostname for image push/pull                |
| `artifacts_bucket`    | S3 bucket name for deployment artifacts                  |
| `db_subnet_group`     | RDS subnet group name (set as `DB_SUBNET_GROUP` on the server) |
| `rds_security_group`  | RDS security group ID (set as `RDS_SECURITY_GROUP_ID` on the server) |
| `builder_public_ip`   | Public IP of the EC2 instance                            |
| `builder_instance_id` | EC2 instance ID (for SSM / EC2 Instance Connect)         |
| `api_access_key_id`   | IAM access key ID for the server (secret delivered separately) |

---

## After Terraform: Deploying the Application

1. **SSH or connect to the EC2 instance**

   ```bash
   # Via EC2 Instance Connect (no key file needed if configured)
   aws ec2-instance-connect ssh --instance-id INSTANCE_ID --region us-east-1

   # Or via SSH
   ssh -i ~/.ssh/your-key.pem ec2-user@BUILDER_PUBLIC_IP
   ```

2. **Authenticate Docker with ECR**

   ```bash
   aws ecr get-login-password --region us-east-1 \
     | docker login --username AWS --password-stdin \
       YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
   ```

3. **Copy `docker-compose.prod.yml` to the instance and set environment variables**

   Create a `.env` file on the instance with at minimum:

   ```bash
   DATABASE_URL=postgresql://user:pass@your-rds-endpoint:5432/capsule
   CAPSULE_SECRET_KEY=a-long-random-secret
   CAPSULE_PUBLIC_HOST=api.your-domain.com
   CORS_ALLOWED_ORIGINS=https://app.your-domain.com
   AWS_ACCESS_KEY_ID=...       # from terraform output api_access_key_id
   AWS_SECRET_ACCESS_KEY=...   # from IAM console
   AWS_ACCOUNT_ID=...
   ALB_DNS_NAME=...            # from terraform output alb_dns_name
   DB_SUBNET_GROUP=capsule     # from terraform output db_subnet_group
   RDS_SECURITY_GROUP_ID=...   # from terraform output rds_security_group
   ```

4. **Pull images and start services**

   ```bash
   docker compose -f docker-compose.prod.yml pull
   docker compose -f docker-compose.prod.yml up -d
   ```

5. **Run database migrations**

   ```bash
   docker compose -f docker-compose.prod.yml exec backend \
     /app/capsule-server migrate up
   ```

---

## Directory Structure

```
deploy/
├── terraform/
│   ├── main.tf          Provider configuration
│   ├── variables.tf     Input variable definitions
│   ├── outputs.tf       Output value definitions
│   ├── ec2.tf           EC2 instance, key pair, security group
│   ├── ecr.tf           ECR repositories
│   ├── s3.tf            S3 buckets
│   ├── alb.tf           Application Load Balancer
│   ├── iam.tf           IAM user, policy, and access keys
│   └── rds.tf           RDS subnet group and security group
└── README.md
```
