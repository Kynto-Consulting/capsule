resource "aws_s3_bucket" "artifacts" {
  bucket = "capsule-artifacts-${var.aws_account_id}"

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Audio waiting for Amazon Transcribe (docs/AI_MULTIMODAL.md): the API deletes each file when its job ends; this rule is the safety net
# for jobs nobody polls again. Versioning is on, so old versions go too.
resource "aws_s3_bucket_lifecycle_configuration" "artifacts_ai_stage" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "expire-ai-stage"
    status = "Enabled"

    filter {
      prefix = "ai-stage/"
    }

    expiration {
      days = 1
    }

    noncurrent_version_expiration {
      noncurrent_days = 1
    }
  }

  depends_on = [aws_s3_bucket_versioning.artifacts]
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "artifacts_bucket_name" {
  description = "Name of the S3 artifacts bucket"
  value       = aws_s3_bucket.artifacts.bucket
}

output "artifacts_bucket_arn" {
  description = "ARN of the S3 artifacts bucket"
  value       = aws_s3_bucket.artifacts.arn
}
