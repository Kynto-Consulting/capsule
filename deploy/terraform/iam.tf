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
      },
      {
        Sid    = "SSMDeployAccess"
        Effect = "Allow"
        Action = [
          "ssm:StartSession",
          "ssm:SendCommand",
          "ssm:GetCommandInvocation",
          "ssm:DescribeInstanceInformation",
          "ssm:ListCommandInvocations",
          "ssm:TerminateSession"
        ]
        Resource = "*"
      }
    ]
  })
}

# ── Lambda execution role ──────────────────────────────────────────────────────
# Role itself is defined in ec2.tf as aws_iam_role.lambda_execution (capsule-lambda-role).
# We attach additional policies here.

resource "aws_iam_role_policy_attachment" "lambda_ecr_read" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_role_policy" "lambda_inline" {
  name = "capsule-lambda-inline"
  role = aws_iam_role.lambda_execution.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
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
