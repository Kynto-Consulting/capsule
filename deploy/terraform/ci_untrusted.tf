# Untrusted CI runner (label ci-untrusted). EVERYTHING here is count = 0 unless var.ci_untrusted_enabled.
#
# Why a second instance: the "ci" runner (runner.tf) is trusted: it runs branches of the repository and
# jobs that receive secrets. Pull requests from contributors who are not administrators (only if that is
# ever enabled; v1 has no forks and no external accounts) must run somewhere that holds NO secret and
# cannot reach anything of the platform. This instance therefore has:
#   - its own role: SSM Session Manager + ONE SSM parameter (its own registration token), nothing else
#   - its own security group: no ingress at all, egress 80/443/53/123 only
#   - IMDSv2 required, hop limit 1 (containers cannot reach instance credentials)
#   - the same host firewall as "ci" (job containers cannot reach the VPC nor 169.254.0.0/16)
#   - label ci-untrusted ONLY (never ci/node22), capacity 1, tighter job limits
# Register it against a Forgejo scope (organization or repository) that has no secrets and no
# deploy tokens; never at instance level, so trusted jobs cannot be scheduled here and vice versa.
# Workflow policy (deploy/forgejo/workflows/workflow-policy.yml) allows the label ci-untrusted.

variable "ci_untrusted_enabled" {
  description = "Create the separate EC2 instance for untrusted CI (label ci-untrusted). false = nothing is created."
  type        = bool
  default     = false
}

variable "ci_untrusted_instance_type" {
  description = "Instance type of the untrusted CI runner."
  type        = string
  default     = "t3.medium"
}

variable "ci_untrusted_volume_gb" {
  description = "Encrypted root volume size for the untrusted CI runner."
  type        = number
  default     = 40
}

variable "ci_untrusted_token_param" {
  description = "SSM Parameter Store name (SecureString) with the registration token of the untrusted runner scope. Created by hand, never by Terraform."
  type        = string
  default     = "/capsule/forgejo/runner-untrusted-registration-token"
}

variable "ci_untrusted_labels" {
  description = "Runner labels (forgejo-runner syntax). Must not include the trusted labels ci / node22."
  type        = list(string)
  default     = ["ci-untrusted:docker://node:22-bookworm"]

  validation {
    condition     = alltrue([for l in var.ci_untrusted_labels : !contains(["ci", "node22"], split(":", l)[0])])
    error_message = "The untrusted runner must not carry the trusted labels ci or node22."
  }
}

variable "ci_untrusted_capacity" {
  description = "Jobs the untrusted runner executes in parallel."
  type        = number
  default     = 1
}

variable "ci_untrusted_job_memory" {
  description = "Docker --memory limit for every untrusted job container."
  type        = string
  default     = "1g"
}

variable "ci_untrusted_job_cpus" {
  description = "Docker --cpus limit for every untrusted job container."
  type        = string
  default     = "1"
}

locals {
  ci_untrusted_count     = var.ci_untrusted_enabled ? 1 : 0
  ci_untrusted_param_arn = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${startswith(var.ci_untrusted_token_param, "/") ? "" : "/"}${var.ci_untrusted_token_param}"
}

resource "aws_iam_role" "ci_untrusted" {
  count              = local.ci_untrusted_count
  name               = "${var.app_name}-ci-untrusted"
  assume_role_policy = data.aws_iam_policy_document.ci_runner_assume.json

  tags = {
    ManagedBy = "terraform"
    Component = "ci-untrusted"
  }
}

resource "aws_iam_role_policy_attachment" "ci_untrusted_ssm" {
  count      = local.ci_untrusted_count
  role       = aws_iam_role.ci_untrusted[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "ci_untrusted_token" {
  statement {
    sid       = "ReadUntrustedRunnerRegistrationToken"
    actions   = ["ssm:GetParameter"]
    resources = [local.ci_untrusted_param_arn]
  }
}

resource "aws_iam_role_policy" "ci_untrusted_token" {
  count  = local.ci_untrusted_count
  name   = "read-untrusted-runner-registration-token"
  role   = aws_iam_role.ci_untrusted[0].id
  policy = data.aws_iam_policy_document.ci_untrusted_token.json
}

resource "aws_iam_instance_profile" "ci_untrusted" {
  count = local.ci_untrusted_count
  name  = "${var.app_name}-ci-untrusted"
  role  = aws_iam_role.ci_untrusted[0].name
}

# No ingress rules at all. Egress: HTTPS/HTTP, DNS, NTP (same shape as "ci").
resource "aws_security_group" "ci_untrusted" {
  count       = local.ci_untrusted_count
  name        = "${var.app_name}-ci-untrusted"
  description = "Untrusted CI runner: no ingress, restricted egress"
  vpc_id      = data.aws_vpc.default.id

  egress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "HTTP (package mirrors)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "DNS udp"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "DNS tcp"
    from_port   = 53
    to_port     = 53
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "NTP"
    from_port   = 123
    to_port     = 123
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name      = "${var.app_name}-ci-untrusted"
    ManagedBy = "terraform"
    Component = "ci-untrusted"
  }
}

resource "aws_instance" "ci_untrusted" {
  count                       = local.ci_untrusted_count
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = var.ci_untrusted_instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.ci_untrusted[0].id]
  iam_instance_profile        = aws_iam_instance_profile.ci_untrusted[0].name
  associate_public_ip_address = true # egress only (default VPC has no NAT); the SG has no ingress
  # No key_name: no SSH, access through SSM Session Manager.

  # IMDSv2 only, hop limit 1: containers (one extra hop) cannot get instance credentials.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.ci_untrusted_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/runner_user_data.sh.tftpl", {
    region       = var.aws_region
    instance_url = var.ci_runner_instance_url
    token_param  = var.ci_untrusted_token_param
    version      = var.ci_runner_version
    sha256       = var.ci_runner_sha256
    labels       = join(",", var.ci_untrusted_labels)
    capacity     = var.ci_untrusted_capacity
    job_memory   = var.ci_untrusted_job_memory
    job_cpus     = var.ci_untrusted_job_cpus
    vpc_cidr     = data.aws_vpc.default.cidr_block
    vpc_dns      = cidrhost(data.aws_vpc.default.cidr_block, 2)
    runner_name  = "${var.app_name}-ci-untrusted"
  })

  tags = {
    Name      = "${var.app_name}-ci-untrusted"
    ManagedBy = "terraform"
    Component = "ci-untrusted"
  }

  lifecycle {
    precondition {
      condition     = length(var.ci_runner_sha256) == 64
      error_message = "ci_runner_sha256 must be the 64-hex SHA-256 of the forgejo-runner binary."
    }
  }
}

output "ci_untrusted_instance_id" {
  description = "Untrusted CI runner instance (connect with: aws ssm start-session --target <id>). null when disabled."
  value       = try(aws_instance.ci_untrusted[0].id, null)
}
