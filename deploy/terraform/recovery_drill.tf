# Ephemeral instance for the monthly recovery drill (docs/git-capsule/DR-BACKUP.md section 8).
# EVERYTHING here is count = 0 unless var.recovery_drill_enabled = true, and this file is meant to
# be used with `terraform plan` / `validate` only in this phase (no apply from the repo).
#
# What the drill instance is: a short-lived t3.medium that restores the REAL backups into itself
# (`capsule recover apply --target ephemeral`, deploy/recovery/drill.sh), runs the smoke checks,
# uploads the report to s3://<backups bucket>/drills/ and terminates itself. It never touches DNS,
# the elastic IP, RDS or the production host.
#
# Isolation (honest limits):
#   - no inbound traffic at all (empty ingress; access only through SSM Session Manager);
#   - its role can READ the backups bucket and the Forgejo backups bucket and WRITE only the
#     drills/ prefix of the backups bucket; it has no access to RDS, ECR, EC2 or production secrets;
#   - it dies by itself: shutdown behavior = terminate plus a timer in user_data (var.recovery_drill_ttl_hours),
#     and the instance is tagged capsule:recovery=drill / capsule:expires for the sweep in README;
#   - it sits in the default VPC (the one this Terraform already uses) with a public IP only for
#     egress, like the CI runner. A dedicated isolated subnet with an S3 gateway endpoint is the
#     stronger design but changes route tables of the VPC production uses, so it is left as a
#     documented follow-up instead of being applied blind.

variable "recovery_drill_enabled" {
  description = "Create the ephemeral recovery drill instance. false = nothing is created."
  type        = bool
  default     = false
}

variable "recovery_drill_instance_type" {
  description = "Instance type of the drill host (DR-BACKUP.md: t3.medium spot-like, a few hours a month)."
  type        = string
  default     = "t3.medium"
}

variable "recovery_drill_ttl_hours" {
  description = "Hours before the drill instance terminates itself (DR-BACKUP.md: 4)."
  type        = number
  default     = 4

  validation {
    condition     = var.recovery_drill_ttl_hours >= 1 && var.recovery_drill_ttl_hours <= 12
    error_message = "recovery_drill_ttl_hours must be between 1 and 12."
  }
}

variable "recovery_drill_volume_gb" {
  description = "Encrypted root volume of the drill host: must hold the restored data (Forgejo dump, database dumps, volumes)."
  type        = number
  default     = 60
}

locals {
  recovery_drill_count = var.recovery_drill_enabled ? 1 : 0
  # backups bucket exists only when backups_enabled (backups.tf); the Forgejo bucket always exists
  recovery_drill_bucket_arns = compact([
    try(aws_s3_bucket.backups[0].arn, ""),
    aws_s3_bucket.forgejo_backups.arn,
  ])
  recovery_drill_reports_arn = try("${aws_s3_bucket.backups[0].arn}/drills/*", "")
}

data "aws_iam_policy_document" "recovery_drill_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "recovery_drill" {
  count              = local.recovery_drill_count
  name               = "${var.app_name}-recovery-drill"
  assume_role_policy = data.aws_iam_policy_document.recovery_drill_assume.json

  tags = {
    ManagedBy = "terraform"
    Component = "recovery-drill"
  }
}

resource "aws_iam_role_policy_attachment" "recovery_drill_ssm" {
  count      = local.recovery_drill_count
  role       = aws_iam_role.recovery_drill[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "recovery_drill_data" {
  statement {
    sid       = "ListAndReadBackups"
    actions   = ["s3:ListBucket", "s3:GetBucketLocation"]
    resources = local.recovery_drill_bucket_arns
  }

  statement {
    sid       = "ReadBackupObjects"
    actions   = ["s3:GetObject", "s3:GetObjectVersion"]
    resources = [for a in local.recovery_drill_bucket_arns : "${a}/*"]
  }

  dynamic "statement" {
    for_each = local.recovery_drill_reports_arn == "" ? [] : [1]

    content {
      sid       = "WriteDrillReports"
      actions   = ["s3:PutObject"]
      resources = [local.recovery_drill_reports_arn]
    }
  }
}

resource "aws_iam_role_policy" "recovery_drill_data" {
  count  = local.recovery_drill_count
  name   = "read-backups-write-drill-reports"
  role   = aws_iam_role.recovery_drill[0].id
  policy = data.aws_iam_policy_document.recovery_drill_data.json
}

resource "aws_iam_instance_profile" "recovery_drill" {
  count = local.recovery_drill_count
  name  = "${var.app_name}-recovery-drill"
  role  = aws_iam_role.recovery_drill[0].name
}

resource "aws_security_group" "recovery_drill" {
  count       = local.recovery_drill_count
  name        = "${var.app_name}-recovery-drill"
  description = "Recovery drill host: no ingress; egress only HTTPS and DNS (S3, SSM, package mirrors)"
  vpc_id      = data.aws_vpc.default.id

  egress {
    description = "HTTPS (S3, SSM, packages)"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "DNS"
    from_port   = 53
    to_port     = 53
    protocol    = "udp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name      = "${var.app_name}-recovery-drill"
    ManagedBy = "terraform"
    Component = "recovery-drill"
  }
}

resource "aws_instance" "recovery_drill" {
  count                       = local.recovery_drill_count
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = var.recovery_drill_instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.recovery_drill[0].id]
  iam_instance_profile        = aws_iam_instance_profile.recovery_drill[0].name
  associate_public_ip_address = true # egress only; the SG has no ingress
  # No key_name: no SSH, access through SSM Session Manager.

  # A shutdown (including the timer below) destroys the instance and its volume.
  instance_initiated_shutdown_behavior = "terminate"

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.recovery_drill_volume_gb
    encrypted             = true
    delete_on_termination = true
  }

  user_data_replace_on_change = true
  user_data                   = <<-EOT
    #!/bin/bash
    # Self-destruct timer first: whatever else happens, the host is gone after the TTL.
    shutdown -h +${var.recovery_drill_ttl_hours * 60}
    dnf install -y docker git openssl tar >/dev/null 2>&1 || true
    systemctl enable --now docker || true
  EOT

  tags = {
    Name                = "${var.app_name}-recovery-drill"
    ManagedBy           = "terraform"
    Component           = "recovery-drill"
    "capsule:recovery"  = "drill"
    "capsule:ttl-hours" = tostring(var.recovery_drill_ttl_hours)
  }
}

output "recovery_drill_instance_id" {
  description = "Instance id of the recovery drill host (empty while recovery_drill_enabled = false). Open it with: aws ssm start-session --target <id>"
  value       = try(aws_instance.recovery_drill[0].id, "")
}
