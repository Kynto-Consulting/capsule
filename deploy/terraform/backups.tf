# ── Backups ──────────────────────────────────────────────────────────────────
# Two independent layers, both controlled by variables so an install can opt out:
#
#   1. EBS snapshots of the app host (this file, Data Lifecycle Manager). OPTIONAL and OFF by default:
#      they capture docker images/layers (most of the disk), which are rebuildable, not data.
#   2. DATA backups to S3 (database dumps and project volumes), the default layer, driven by Capsule
#      itself per project (flag + schedule in the API/CLI). This file only creates the bucket
#      and the permissions; the schedule lives in Capsule.
#
# Rough cost (us-east-1): EBS snapshots $0.05/GB-month of changed data (first snapshot = used
# blocks); S3 Standard $0.023/GB-month. Switch both off with backups_enabled = false.

variable "backups_enabled" {
  description = "Master switch for platform backups (EBS snapshot policy and the S3 backups bucket)."
  type        = bool
  default     = true
}

variable "backup_ebs_enabled" {
  description = <<-EOT
    Also snapshot the whole app host volume with DLM (only when backups_enabled). Off by default:
    it copies docker images and everything deployed, which is rebuildable; Capsule backs up DATA
    (database dumps and project volumes to S3) instead. Turn it on only as a whole-host safety net.
  EOT
  type        = bool
  default     = false
}

variable "backup_interval_hours" {
  description = "Hours between EBS snapshots. DLM accepts 1, 2, 3, 4, 6, 8, 12 or 24."
  type        = number
  default     = 24
  validation {
    condition     = contains([1, 2, 3, 4, 6, 8, 12, 24], var.backup_interval_hours)
    error_message = "backup_interval_hours must be one of 1, 2, 3, 4, 6, 8, 12, 24."
  }
}

variable "backup_start_time_utc" {
  description = "HH:MM (UTC) of the first daily snapshot window."
  type        = string
  default     = "07:00"
}

variable "backup_retention_count" {
  description = "How many EBS snapshots to keep."
  type        = number
  default     = 7
}

variable "backup_s3_retention_days" {
  description = "Days to keep application backups in the S3 bucket."
  type        = number
  default     = 30
}

locals {
  backups_on     = var.backups_enabled
  backups_ebs_on = var.backups_enabled && var.backup_ebs_enabled
}

# ── EBS snapshots (DLM) ──────────────────────────────────────────────────────

resource "aws_iam_role" "dlm" {
  count = local.backups_ebs_on ? 1 : 0
  name  = "${var.app_name}-dlm"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "dlm.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_iam_role_policy_attachment" "dlm" {
  count      = local.backups_ebs_on ? 1 : 0
  role       = aws_iam_role.dlm[0].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole"
}

# The policy targets volumes tagged capsule-backup=true. The tag is added to the host's root
# volume without touching the instance resource.
resource "aws_ec2_tag" "host_volume_backup" {
  count       = local.backups_ebs_on ? 1 : 0
  resource_id = aws_instance.builder.root_block_device[0].volume_id
  key         = "capsule-backup"
  value       = "true"
}

resource "aws_dlm_lifecycle_policy" "host" {
  count              = local.backups_ebs_on ? 1 : 0
  description        = "Capsule app host volume snapshots"
  execution_role_arn = aws_iam_role.dlm[0].arn
  state              = "ENABLED"

  policy_details {
    resource_types = ["VOLUME"]
    target_tags    = { "capsule-backup" = "true" }

    schedule {
      name = "capsule-host-${var.backup_interval_hours}h"

      create_rule {
        interval      = var.backup_interval_hours
        interval_unit = "HOURS"
        times         = [var.backup_start_time_utc]
      }

      retain_rule {
        count = var.backup_retention_count
      }

      tags_to_add = {
        SnapshotCreator = "capsule-dlm"
      }

      copy_tags = true
    }
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# ── S3 bucket for application-level backups ─────────────────────────────────

resource "aws_s3_bucket" "backups" {
  count  = local.backups_on ? 1 : 0
  bucket = "capsule-backups-${var.aws_account_id}"

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  count  = local.backups_on ? 1 : 0
  bucket = aws_s3_bucket.backups[0].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  count  = local.backups_on ? 1 : 0
  bucket = aws_s3_bucket.backups[0].id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "backups" {
  count                   = local.backups_on ? 1 : 0
  bucket                  = aws_s3_bucket.backups[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  count  = local.backups_on ? 1 : 0
  bucket = aws_s3_bucket.backups[0].id

  rule {
    id     = "expire-old-backups"
    status = "Enabled"
    filter {}

    expiration {
      days = var.backup_s3_retention_days
    }
    noncurrent_version_expiration {
      noncurrent_days = 7
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 2
    }
  }
}

# Capsule's API user writes and restores backups. It may delete objects only under projects/*
# (per-project retention_days); the platform/ prefix is only ever removed by the bucket lifecycle.
resource "aws_iam_policy" "capsule_api_backups" {
  count = local.backups_on ? 1 : 0
  name  = "${var.app_name}-api-backups"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "BackupsList"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.backups[0].arn
      },
      {
        Sid      = "BackupsReadWrite"
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:AbortMultipartUpload"]
        Resource = "${aws_s3_bucket.backups[0].arn}/*"
      },
      {
        Sid      = "BackupsRetentionDelete"
        Effect   = "Allow"
        Action   = ["s3:DeleteObject"]
        Resource = "${aws_s3_bucket.backups[0].arn}/projects/*"
      },
    ]
  })
}

resource "aws_iam_user_policy_attachment" "capsule_api_backups" {
  count      = local.backups_on ? 1 : 0
  user       = aws_iam_user.capsule_api.name
  policy_arn = aws_iam_policy.capsule_api_backups[0].arn
}

output "backups_bucket" {
  description = "S3 bucket for application-level backups (empty when backups are disabled)"
  value       = local.backups_on ? aws_s3_bucket.backups[0].bucket : ""
}
