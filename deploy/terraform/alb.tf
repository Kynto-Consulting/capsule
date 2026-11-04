resource "aws_lb" "capsule" {
  count = var.alb_enabled ? 1 : 0

  name               = "${var.app_name}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  # An ALB needs at least 2 AZs. Every extra subnet adds a public IPv4 address that AWS bills (~3.65 USD/month each), so the
  # default is the explicit short list in var.alb_subnet_ids; empty keeps one subnet per AZ (all of them).
  subnets = length(var.alb_subnet_ids) > 0 ? var.alb_subnet_ids : data.aws_subnets.default.ids
  # "dualstack" only when var.ipv6_enabled (ipv6.tf); the subnets need an IPv6 /64 first.
  ip_address_type = var.ipv6_enabled ? "dualstack" : "ipv4"

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
  count = var.alb_enabled ? 1 : 0

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
  count = var.alb_enabled ? 1 : 0

  target_group_arn = aws_lb_target_group.frontend[0].arn
  target_id        = aws_instance.builder.id
  port             = 3000
}

# Target group → backend on port 8080
resource "aws_lb_target_group" "backend" {
  count = var.alb_enabled ? 1 : 0

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
  count = var.alb_enabled ? 1 : 0

  target_group_arn = aws_lb_target_group.backend[0].arn
  target_id        = aws_instance.builder.id
  port             = 8080
}

# HTTP → HTTPS redirect
resource "aws_lb_listener" "http" {
  count = var.alb_enabled ? 1 : 0

  load_balancer_arn = aws_lb.capsule[0].arn
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
  count = var.alb_enabled ? 1 : 0

  load_balancer_arn = aws_lb.capsule[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate.capsule.arn

  # Default: forward to frontend
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend[0].arn
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# app.tumi-ai.com → frontend (port 3000)
resource "aws_lb_listener_rule" "app" {
  count = var.alb_enabled ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.frontend[0].arn
  }

  condition {
    host_header {
      values = ["app.tumi-ai.com"]
    }
  }
}

# api.tumi-ai.com → backend (port 8080)
resource "aws_lb_listener_rule" "api" {
  count = var.alb_enabled ? 1 : 0

  listener_arn = aws_lb_listener.https[0].arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend[0].arn
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
  value       = try(aws_lb.capsule[0].dns_name, null)
}

output "alb_arn" {
  description = "ARN of the Capsule ALB"
  value       = try(aws_lb.capsule[0].arn, null)
}

output "alb_zone_id" {
  description = "Route53 hosted zone ID for the ALB (used for alias records)"
  value       = try(aws_lb.capsule[0].zone_id, null)
}

output "http_listener_arn" {
  description = "ARN of the HTTP (port 80) ALB listener"
  value       = try(aws_lb_listener.http[0].arn, null)
}

variable "alb_subnet_ids" {
  description = "Subnets of the load balancer (at least 2, in different AZs). Empty = all default subnets. Each one carries a billed public IPv4 address."
  type        = list(string)
  default     = []
}

variable "alb_enabled" {
  description = "Create the application load balancer and its listeners/target groups. false = the web is served by Caddy on the host (docs/gateway/RUNBOOK-alb-removal.md)."
  type        = bool
  default     = true
}

# Resources gained a count (alb_enabled): moved blocks keep their state.
moved {
  from = aws_lb.capsule
  to   = aws_lb.capsule[0]
}

moved {
  from = aws_lb_target_group.frontend
  to   = aws_lb_target_group.frontend[0]
}

moved {
  from = aws_lb_target_group_attachment.frontend
  to   = aws_lb_target_group_attachment.frontend[0]
}

moved {
  from = aws_lb_target_group.backend
  to   = aws_lb_target_group.backend[0]
}

moved {
  from = aws_lb_target_group_attachment.backend
  to   = aws_lb_target_group_attachment.backend[0]
}

moved {
  from = aws_lb_listener.http
  to   = aws_lb_listener.http[0]
}

moved {
  from = aws_lb_listener.https
  to   = aws_lb_listener.https[0]
}

moved {
  from = aws_lb_listener_rule.app
  to   = aws_lb_listener_rule.app[0]
}

moved {
  from = aws_lb_listener_rule.api
  to   = aws_lb_listener_rule.api[0]
}

moved {
  from = aws_lb_listener_certificate.apps_wildcard
  to   = aws_lb_listener_certificate.apps_wildcard[0]
}
