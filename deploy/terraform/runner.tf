# Isolated CI runner for Forgejo Actions. EVERYTHING here is count = 0 unless
# var.ci_runner_enabled = true.
#
# Threat model: repository code (including pull requests) runs on this host.
# It therefore gets: its own instance, no inbound traffic at all (SSM only),
# egress limited to web/DNS/NTP, IMDSv2 with hop limit 1, a role that can only
# read ONE SSM parameter, and iptables rules that stop job containers from
# reaching the VPC (Capsule server, RDS) and the metadata service.

locals {
  ci_runner_count     = var.ci_runner_enabled ? 1 : 0
  ci_runner_param_arn = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${startswith(var.ci_runner_token_param, "/") ? "" : "/"}${var.ci_runner_token_param}"
}

data "aws_iam_policy_document" "ci_runner_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "ci_runner" {
  count              = local.ci_runner_count
  name               = "${var.app_name}-ci-runner"
  assume_role_policy = data.aws_iam_policy_document.ci_runner_assume.json

  tags = {
    ManagedBy = "terraform"
    Component = "ci-runner"
  }
}

# Session Manager access (replaces SSH). Nothing else.
resource "aws_iam_role_policy_attachment" "ci_runner_ssm" {
  count      = local.ci_runner_count
  role       = aws_iam_role.ci_runner[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "ci_runner_token" {
  statement {
    sid       = "ReadRunnerRegistrationToken"
    actions   = ["ssm:GetParameter"]
    resources = [local.ci_runner_param_arn]
  }
}

resource "aws_iam_role_policy" "ci_runner_token" {
  count  = local.ci_runner_count
  name   = "read-runner-registration-token"
  role   = aws_iam_role.ci_runner[0].id
  policy = data.aws_iam_policy_document.ci_runner_token.json
}

resource "aws_iam_instance_profile" "ci_runner" {
  count = local.ci_runner_count
  name  = "${var.app_name}-ci-runner"
  role  = aws_iam_role.ci_runner[0].name
}

# No ingress rules at all. Egress: HTTPS/HTTP (git, registries, npm), DNS, NTP.
resource "aws_security_group" "ci_runner" {
  count       = local.ci_runner_count
  name        = "${var.app_name}-ci-runner"
  description = "Forgejo CI runner: no ingress, restricted egress"
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
    Name      = "${var.app_name}-ci-runner"
    ManagedBy = "terraform"
    Component = "ci-runner"
  }
}

resource "aws_instance" "ci_runner" {
  count                       = local.ci_runner_count
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = var.ci_runner_instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.ci_runner[0].id]
  iam_instance_profile        = aws_iam_instance_profile.ci_runner[0].name
  associate_public_ip_address = true # only for egress (default VPC has no NAT); the SG has no ingress
  # No key_name: no SSH at all, access through SSM Session Manager.

  # IMDSv2 only, hop limit 1: containers (one extra hop) cannot get instance credentials.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.ci_runner_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  dynamic "instance_market_options" {
    for_each = var.ci_runner_spot ? [1] : []

    content {
      market_type = "spot"

      spot_options {
        spot_instance_type             = "persistent"
        instance_interruption_behavior = "stop"
      }
    }
  }

  user_data_replace_on_change = true
  user_data = templatefile("${path.module}/runner_user_data.sh.tftpl", {
    region       = var.aws_region
    instance_url = var.ci_runner_instance_url
    token_param  = var.ci_runner_token_param
    version      = var.ci_runner_version
    sha256       = var.ci_runner_sha256
    labels       = join(",", var.ci_runner_labels)
    capacity     = var.ci_runner_capacity
    job_memory   = var.ci_runner_job_memory
    job_cpus     = var.ci_runner_job_cpus
    vpc_cidr     = data.aws_vpc.default.cidr_block
    vpc_dns      = cidrhost(data.aws_vpc.default.cidr_block, 2)
    runner_name  = "${var.app_name}-ci-runner"
  })

  tags = {
    Name      = "${var.app_name}-ci-runner"
    ManagedBy = "terraform"
    Component = "ci-runner"
  }

  lifecycle {
    precondition {
      condition     = length(var.ci_runner_sha256) == 64
      error_message = "ci_runner_sha256 must be the 64-hex SHA-256 of the forgejo-runner binary when ci_runner_enabled = true."
    }
  }
}

output "ci_runner_instance_id" {
  description = "CI runner instance (connect with: aws ssm start-session --target <id>). null when disabled."
  value       = try(aws_instance.ci_runner[0].id, null)
}
