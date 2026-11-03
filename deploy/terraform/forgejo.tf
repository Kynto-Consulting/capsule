# Backups of Forgejo (`forgejo dump`, encrypted client-side before upload).
# Nothing here touches existing resources.

resource "aws_s3_bucket" "forgejo_backups" {
  bucket = "capsule-forgejo-backups-${var.aws_account_id}"

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
    Component   = "forgejo"
  }
}

resource "aws_s3_bucket_versioning" "forgejo_backups" {
  bucket = aws_s3_bucket.forgejo_backups.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "forgejo_backups" {
  bucket = aws_s3_bucket.forgejo_backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "forgejo_backups" {
  bucket = aws_s3_bucket.forgejo_backups.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "forgejo_backups" {
  bucket = aws_s3_bucket.forgejo_backups.id

  # Versioning must exist before the lifecycle rules are evaluated sensibly.
  depends_on = [aws_s3_bucket_versioning.forgejo_backups]

  rule {
    id     = "retention"
    status = "Enabled"

    filter {
      prefix = "forgejo/"
    }

    expiration {
      days = var.forgejo_backup_retention_days
    }

    noncurrent_version_expiration {
      noncurrent_days = var.forgejo_backup_retention_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

data "aws_iam_policy_document" "forgejo_backups_bucket" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.forgejo_backups.arn, "${aws_s3_bucket.forgejo_backups.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "forgejo_backups" {
  bucket     = aws_s3_bucket.forgejo_backups.id
  policy     = data.aws_iam_policy_document.forgejo_backups_bucket.json
  depends_on = [aws_s3_bucket_public_access_block.forgejo_backups]
}

# Uploader: can write new objects and list the prefix. Cannot read or delete
# (a compromised Forgejo host cannot read or destroy older backups).
# The access key is NOT created here (it would land in the state file):
#   aws iam create-access-key --user-name capsule-forgejo-backup
resource "aws_iam_user" "forgejo_backup" {
  name = "capsule-forgejo-backup"

  tags = {
    ManagedBy = "terraform"
    Project   = "capsule"
    Component = "forgejo"
  }
}

data "aws_iam_policy_document" "forgejo_backup_user" {
  statement {
    sid       = "PutBackups"
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.forgejo_backups.arn}/forgejo/*"]
  }

  statement {
    sid       = "ListBackups"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.forgejo_backups.arn]

    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["forgejo/*", "forgejo/"]
    }
  }
}

resource "aws_iam_user_policy" "forgejo_backup" {
  name   = "forgejo-backup-upload"
  user   = aws_iam_user.forgejo_backup.name
  policy = data.aws_iam_policy_document.forgejo_backup_user.json
}

output "forgejo_backups_bucket_name" {
  description = "S3 bucket receiving encrypted Forgejo dumps"
  value       = aws_s3_bucket.forgejo_backups.bucket
}

output "forgejo_backup_iam_user" {
  description = "IAM user that uploads Forgejo dumps (create its access key manually)"
  value       = aws_iam_user.forgejo_backup.name
}
