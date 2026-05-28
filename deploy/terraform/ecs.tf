# ── ECS Cluster ──────────────────────────────────────────────────────────────

resource "aws_ecs_cluster" "apps" {
  name = "${var.app_name}-apps"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_ecs_cluster_capacity_providers" "apps" {
  cluster_name       = aws_ecs_cluster.apps.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
  }
}

# ── ECS Task Execution Role ───────────────────────────────────────────────────
# Allows ECS tasks to pull from ECR and write to CloudWatch Logs.

resource "aws_iam_role" "ecs_task_execution" {
  name = "${var.app_name}-ecs-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_basic" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Extra policy: allow create-log-group so awslogs driver can auto-create groups
resource "aws_iam_role_policy" "ecs_task_execution_logs" {
  name = "cloudwatch-create-log-group"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogGroup"]
      Resource = "arn:aws:logs:*:*:log-group:/capsule/apps/*"
    }]
  })
}

# ── Security Group for Fargate tasks ─────────────────────────────────────────
# Allows inbound traffic only from the ALB SG, and all outbound (for ECR pull, etc).

resource "aws_security_group" "fargate_tasks" {
  name        = "${var.app_name}-fargate-tasks"
  description = "Capsule Fargate app tasks — inbound from ALB only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "HTTP from ALB"
    from_port       = 0
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# ── ACM wildcard cert for apps subdomain ─────────────────────────────────────
# e.g. *.apps.tumi-ai.com → Fargate apps via ALB

resource "aws_acm_certificate" "apps_wildcard" {
  domain_name       = "*.apps.tumi-ai.com"
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# Attach wildcard cert to the HTTPS listener so *.apps.tumi-ai.com resolves
resource "aws_lb_listener_certificate" "apps_wildcard" {
  listener_arn    = aws_lb_listener.https.arn
  certificate_arn = aws_acm_certificate.apps_wildcard.arn
}

# ── IAM: allow Capsule API role to manage ECS + ELB ─────────────────────────

resource "aws_iam_user_policy" "capsule_api_ecs" {
  name = "capsule-api-ecs"
  user = aws_iam_user.capsule_api.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ECSManage"
        Effect = "Allow"
        Action = [
          "ecs:CreateService",
          "ecs:UpdateService",
          "ecs:DeleteService",
          "ecs:DescribeServices",
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:DescribeTaskDefinition",
          "ecs:ListTaskDefinitions",
          "ecs:RunTask",
          "ecs:StopTask",
          "ecs:DescribeTasks",
          "ecs:ListTasks",
          "ecs:TagResource",
        ]
        Resource = "*"
      },
      {
        Sid    = "ELBManage"
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:CreateTargetGroup",
          "elasticloadbalancing:DeleteTargetGroup",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:ModifyTargetGroupAttributes",
          "elasticloadbalancing:CreateRule",
          "elasticloadbalancing:ModifyRule",
          "elasticloadbalancing:DeleteRule",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:AddTags",
        ]
        Resource = "*"
      },
      {
        Sid      = "PassExecutionRole"
        Effect   = "Allow"
        Action   = "iam:PassRole"
        Resource = aws_iam_role.ecs_task_execution.arn
      },
    ]
  })
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "ecs_cluster_arn" {
  description = "ARN of the ECS cluster for Fargate app deployments"
  value       = aws_ecs_cluster.apps.arn
}

output "ecs_cluster_name" {
  description = "Name of the ECS cluster"
  value       = aws_ecs_cluster.apps.name
}

output "ecs_execution_role_arn" {
  description = "IAM role ARN for ECS task execution (ECR pull + CW logs)"
  value       = aws_iam_role.ecs_task_execution.arn
}

output "fargate_security_group_id" {
  description = "Security group ID to attach to Fargate tasks"
  value       = aws_security_group.fargate_tasks.id
}

output "https_listener_arn" {
  description = "ARN of the HTTPS ALB listener (used for dynamic app routing rules)"
  value       = aws_lb_listener.https.arn
}

output "apps_wildcard_cert_validation" {
  description = "DNS validation records for *.apps.tumi-ai.com ACM cert"
  value = {
    for dvo in aws_acm_certificate.apps_wildcard.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }
}

output "vpc_id" {
  description = "VPC ID used by the Capsule infrastructure"
  value       = data.aws_vpc.default.id
}

output "subnet_ids" {
  description = "Subnet IDs available for Fargate tasks"
  value       = data.aws_subnets.default.ids
}
