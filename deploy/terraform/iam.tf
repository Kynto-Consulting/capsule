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

resource "aws_iam_policy" "capsule_api" {
  name = "${var.app_name}-api-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECRFullAccess"
        Effect   = "Allow"
        Action   = ["ecr:*"]
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
        Sid      = "RDSFullAccess"
        Effect   = "Allow"
        Action   = ["rds:*"]
        Resource = "*"
      },
      {
        Sid      = "Route53FullAccess"
        Effect   = "Allow"
        Action   = ["route53:*"]
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
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:InvokeModelWithBidirectionalStream" # speech to speech (Nova Sonic), docs/AI_MULTIMODAL.md
        ]
        Resource = "*"
      },
      {
        # Live model catalog and its access state (GET /ai/models?capability=)
        Sid    = "BedrockCatalogRead"
        Effect = "Allow"
        Action = [
          "bedrock:ListFoundationModels",
          "bedrock:GetFoundationModelAvailability",
          "bedrock:ListInferenceProfiles"
        ]
        Resource = "*"
      },
      {
        # Speech to text (batch jobs; the audio is staged under ai-stage/ of the artifacts bucket, already covered above) and text to speech
        Sid    = "TranscribeAndPolly"
        Effect = "Allow"
        Action = [
          "transcribe:StartTranscriptionJob",
          "transcribe:GetTranscriptionJob",
          "polly:SynthesizeSpeech",
          "polly:DescribeVoices"
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
      },
      {
        # Per-database network access: Capsule adds/removes ingress rules on the app host SG only.
        Sid    = "AppSGManageIngress"
        Effect = "Allow"
        Action = [
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress"
        ]
        Resource = aws_security_group.app.arn
      },
      {
        # Describe* does not support resource-level permissions in EC2.
        Sid    = "DescribeSecurityGroups"
        Effect = "Allow"
        Action = [
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeSecurityGroupRules"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_user_policy_attachment" "capsule_api" {
  user       = aws_iam_user.capsule_api.name
  policy_arn = aws_iam_policy.capsule_api.arn
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
        Sid      = "CloudWatchLogs"
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
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
