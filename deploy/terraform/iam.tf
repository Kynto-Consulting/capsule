resource "aws_iam_user" "capsule_api" {
  name = "${var.app_name}-api"

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_iam_access_key" "capsule_api" {
  user = aws_iam_user.capsule_api.name
}

resource "aws_iam_user_policy" "capsule_api" {
  name = "${var.app_name}-api-policy"
  user = aws_iam_user.capsule_api.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECRFullAccess"
        Effect = "Allow"
        Action = ["ecr:*"]
        Resource = "*"
      },
      {
        Sid    = "S3ArtifactsBucketFullAccess"
        Effect = "Allow"
        Action = ["s3:*"]
        Resource = [
          aws_s3_bucket.artifacts.arn,
          "${aws_s3_bucket.artifacts.arn}/*"
        ]
      },
      {
        Sid    = "RDSFullAccess"
        Effect = "Allow"
        Action = ["rds:*"]
        Resource = "*"
      },
      {
        Sid    = "Route53FullAccess"
        Effect = "Allow"
        Action = ["route53:*"]
        Resource = "*"
      },
      {
        Sid    = "ELBRegisterTargets"
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:RegisterTargets",
          "elasticloadbalancing:DeregisterTargets",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetHealth",
          "elasticloadbalancing:CreateTargetGroup",
          "elasticloadbalancing:DeleteTargetGroup",
          "elasticloadbalancing:ModifyTargetGroupAttributes",
          "elasticloadbalancing:CreateRule",
          "elasticloadbalancing:DeleteRule",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:ModifyRule"
        ]
        Resource = "*"
      },
      {
        Sid    = "BedrockInvokeModel"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ]
        Resource = "*"
      }
    ]
  })
}

output "api_access_key_id" {
  description = "AWS access key ID for the Capsule API user"
  value       = aws_iam_access_key.capsule_api.id
}

output "api_secret_access_key" {
  description = "AWS secret access key for the Capsule API user (sensitive)"
  value       = aws_iam_access_key.capsule_api.secret
  sensitive   = true
}
