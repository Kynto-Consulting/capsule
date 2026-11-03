variable "aws_region" {
  description = "AWS region to deploy resources into"
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS account ID"
  type        = string
  default     = "598806201852"
}

variable "environment" {
  description = "Deployment environment name (e.g. production, staging)"
  type        = string
  default     = "production"
}

variable "app_name" {
  description = "Application name used in resource naming"
  type        = string
  default     = "capsule"
}

variable "alb_domain" {
  description = "Domain name for ALB Route53 alias. Leave empty to skip HTTPS listener."
  type        = string
  default     = ""
}

variable "db_instance_class" {
  description = "RDS instance class for provisioned databases"
  type        = string
  default     = "db.t3.micro"
}

variable "ec2_instance_type" {
  description = "EC2 instance type for app / builder servers"
  type        = string
  default     = "t3.small"
}

variable "key_pair_name" {
  description = "Name of the EC2 key pair to attach to instances"
  type        = string
  default     = "capsule-key"
}

variable "ec2_public_key" {
  description = "Public key material for the EC2 key pair. Leave empty if importing an existing key pair."
  type        = string
  default     = ""
  sensitive   = true
}

variable "alb_certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener. Required when alb_domain is non-empty."
  type        = string
  default     = ""
}

variable "db_allowed_cidrs" {
  description = "CIDRs allowed to reach the ports of databases provisioned by Capsule (docker host ports). Empty = not exposed."
  type        = list(string)
  default     = []
}

variable "db_port_from" {
  description = "First host port Capsule may publish databases on (CAPSULE_DB_PORT_RANGE)."
  type        = number
  default     = 40000
}

variable "db_port_to" {
  description = "Last host port Capsule may publish databases on."
  type        = number
  default     = 40199
}

variable "db_extra_ports" {
  description = "Individual host ports of databases created before the dedicated range existed."
  type        = list(number)
  default     = []
}

# ---------------------------------------------------------------------------
# Forgejo (git.tumi-ai.com): backups bucket + isolated CI runner
# ---------------------------------------------------------------------------

variable "forgejo_backup_retention_days" {
  description = "Days Forgejo dump objects are kept in the backups bucket (current and noncurrent versions)."
  type        = number
  default     = 30
}

variable "ci_runner_enabled" {
  description = "Create the isolated EC2 instance that runs Forgejo Actions jobs. false = nothing is created."
  type        = bool
  default     = false
}

variable "ci_runner_instance_type" {
  description = "Instance type of the CI runner host (separate from the Capsule server)."
  type        = string
  default     = "t3.large"
}

variable "ci_runner_spot" {
  description = "Run the CI runner on a (persistent, stop-on-interruption) spot request."
  type        = bool
  default     = true
}

variable "ci_runner_volume_gb" {
  description = "Encrypted root volume size for the CI runner (docker layers + job workspaces)."
  type        = number
  default     = 60
}

variable "ci_runner_version" {
  description = "forgejo-runner version to install (without the leading v). Check https://code.forgejo.org/forgejo/runner/releases."
  type        = string
  default     = "13.2.1"
}

variable "ci_runner_sha256" {
  description = "SHA-256 of the forgejo-runner-<version>-linux-amd64 binary. REQUIRED when ci_runner_enabled = true; the boot script aborts on mismatch. Default = checksum published for 13.2.1 (forgejo-runner-13.2.1-linux-amd64.sha256), recomputed on the downloaded binary."
  type        = string
  default     = "bb369fe1ecb50fdc983c0b1d993f19b0920df6e5864511892b3cdbf16d858b34"
}

variable "ci_runner_instance_url" {
  description = "Forgejo base URL the runner registers against."
  type        = string
  default     = "https://git.tumi-ai.com"
}

variable "ci_runner_token_param" {
  description = "SSM Parameter Store name (SecureString) holding the runner registration token. Created by hand, never by Terraform (keeps it out of state)."
  type        = string
  default     = "/capsule/forgejo/runner-registration-token"
}

variable "ci_runner_labels" {
  description = "Runner labels in forgejo-runner syntax (label:docker://image)."
  type        = list(string)
  default     = ["ci:docker://node:22-bookworm", "node22:docker://node:22-bookworm"]
}

variable "ci_runner_capacity" {
  description = "Jobs the runner executes in parallel."
  type        = number
  default     = 2
}

variable "ci_runner_job_memory" {
  description = "Docker --memory limit applied to every job container."
  type        = string
  default     = "2g"
}

variable "ci_runner_job_cpus" {
  description = "Docker --cpus limit applied to every job container."
  type        = string
  default     = "1.5"
}

# ---------------------------------------------------------------------------
# git (Forgejo core service): security group rules for Caddy and SSH
# ---------------------------------------------------------------------------

variable "git_enabled" {
  description = "Add SG rules 80/443 (Caddy) and 2200 (admin SSH) for git.tumi-ai.com. false = nothing is created."
  type        = bool
  default     = false
}

variable "admin_ssh_cidrs" {
  description = "CIDRs allowed to reach the administration SSH on 2200 (key authentication only). Restrict this to your own IPs."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
