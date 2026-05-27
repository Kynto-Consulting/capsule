resource "aws_lb" "capsule" {
  name               = "${var.app_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = data.aws_subnets.default.ids

  enable_deletion_protection = false

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# ACM certificate for app + api subdomains
resource "aws_acm_certificate" "capsule" {
  domain_name               = "app.tumi-ai.com"
  subject_alternative_names = ["api.tumi-ai.com"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# Target group → frontend on port 3000
resource "aws_lb_target_group" "frontend" {
  name     = "${var.app_name}-frontend"
  port     = 3000
  protocol = "HTTP"
  vpc_id   = data.aws_vpc.default.id

  health_check {
    path                = "/login"
    port                = "3000"
    protocol            = "HTTP"
    matcher             = "200-399"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_lb_target_group_attachment" "frontend" {
  target_group_arn = aws_lb_target_group.frontend.arn
  target_id        = aws_instance.builder.id
  port             = 3000
}

# Target group → backend on port 8080
resource "aws_lb_target_group" "backend" {
  name     = "${var.app_name}-backend"
  port     = 8080
  protocol = "HTTP"
  vpc_id   = data.aws_vpc.default.id

  health_check {
    path                = "/health"
    port                = "8080"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_lb_target_group_attachment" "backend" {
  target_group_arn = aws_lb_target_group.backend.arn
  target_id        = aws_instance.builder.id
  port             = 8080
}

# HTTP → HTTPS redirect
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.capsule.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# HTTPS listener — routes by hostname
resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.capsule.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.capsule.arn

  # Default: forward to frontend
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# app.tumi-ai.com → frontend (port 3000)
resource "aws_lb_listener_rule" "app" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend.arn
  }

  condition {
    host_header {
      values = ["app.tumi-ai.com"]
    }
  }
}

# api.tumi-ai.com → backend (port 8080)
resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }

  condition {
    host_header {
      values = ["api.tumi-ai.com"]
    }
  }
}

output "acm_dns_validation_records" {
  description = "CNAME records to add in Namecheap to validate the ACM certificate"
  value = {
    for dvo in aws_acm_certificate.capsule.domain_validation_options : dvo.domain_name => {
      name  = dvo.resource_record_name
      type  = dvo.resource_record_type
      value = dvo.resource_record_value
    }
  }
}

output "alb_dns_name" {
  description = "DNS name of the Capsule ALB"
  value       = aws_lb.capsule.dns_name
}

output "alb_arn" {
  description = "ARN of the Capsule ALB"
  value       = aws_lb.capsule.arn
}

output "alb_zone_id" {
  description = "Route53 hosted zone ID for the ALB (used for alias records)"
  value       = aws_lb.capsule.zone_id
}

output "http_listener_arn" {
  description = "ARN of the HTTP (port 80) ALB listener"
  value       = aws_lb_listener.http.arn
}
