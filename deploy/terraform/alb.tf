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

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.capsule.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "404 Not Found"
      status_code  = "404"
    }
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# HTTPS listener — only created when alb_domain is non-empty.
# You must provide a valid ACM certificate ARN via var.alb_certificate_arn.
resource "aws_lb_listener" "https" {
  count = var.alb_domain != "" ? 1 : 0

  load_balancer_arn = aws_lb.capsule.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.alb_certificate_arn

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "404 Not Found"
      status_code  = "404"
    }
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
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
