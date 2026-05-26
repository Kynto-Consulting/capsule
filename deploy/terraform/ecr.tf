resource "aws_ecr_repository" "builder" {
  name                 = "capsule/builder"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_ecr_lifecycle_policy" "builder" {
  repository = aws_ecr_repository.builder.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 5 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 5
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_ecr_repository" "server" {
  name                 = "capsule/server"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_ecr_repository" "frontend" {
  name                 = "capsule/frontend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

output "ecr_registry_url" {
  description = "Base ECR registry URL for this account/region"
  value       = "${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "ecr_builder_repository_url" {
  description = "Full URL of the builder ECR repository"
  value       = aws_ecr_repository.builder.repository_url
}

output "ecr_server_repository_url" {
  description = "Full URL of the server ECR repository"
  value       = aws_ecr_repository.server.repository_url
}

output "ecr_frontend_repository_url" {
  description = "Full URL of the frontend ECR repository"
  value       = aws_ecr_repository.frontend.repository_url
}
