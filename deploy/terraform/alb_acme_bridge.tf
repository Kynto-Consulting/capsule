# PUENTE ACME (temporal): permite que Caddy, en el propio servidor, obtenga por HTTP-01 los certificados de app.tumi-ai.com y
# api.tumi-ai.com MIENTRAS el DNS todavia apunta al ALB. LetsEncrypt pide http://app.tumi-ai.com/.well-known/acme-challenge/<token>
# al ALB (puerto 80); esta regla (prioridad 1, antes de la redireccion a https) reenvia SOLO esa ruta, para esos dos hosts, al
# puerto 80 del servidor (Caddy). Todo lo demas del 80 sigue redirigiendo a https como hoy.
# Detras de la variable alb_acme_bridge (false = no crea nada). Se apaga volviendo a false una vez cambiado el DNS (y el ALB se
# retira despues). Procedimiento: docs/gateway/RUNBOOK-alb-removal.md
variable "alb_acme_bridge" {
  description = "true = crea el puente ACME: target group :80 del servidor y regla de prioridad 1 en el listener HTTP:80 del ALB (/.well-known/acme-challenge/* de app y api)."
  type        = bool
  default     = false
}

resource "aws_lb_target_group" "acme_bridge" {
  count       = var.alb_acme_bridge ? 1 : 0
  name        = "${var.app_name}-acme80"
  port        = 80
  protocol    = "HTTP"
  target_type = "instance"
  vpc_id      = data.aws_vpc.default.id

  # Caddy responde 308 (redireccion a https) o 404 a una sonda sin Host conocido: cualquier respuesta HTTP = vivo.
  health_check {
    path                = "/"
    port                = "80"
    protocol            = "HTTP"
    matcher             = "200-499"
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

resource "aws_lb_target_group_attachment" "acme_bridge" {
  count            = var.alb_acme_bridge ? 1 : 0
  target_group_arn = aws_lb_target_group.acme_bridge[0].arn
  target_id        = aws_instance.builder.id
  port             = 80
}

# El security group del servidor ya abre el 80 al mundo cuando git_enabled (git.tf); esta regla lo garantiza desde el ALB aunque no.
resource "aws_security_group_rule" "acme_bridge_from_alb" {
  count                    = var.alb_acme_bridge ? 1 : 0
  type                     = "ingress"
  description              = "ALB to Caddy :80 (ACME HTTP-01 bridge)"
  from_port                = 80
  to_port                  = 80
  protocol                 = "tcp"
  security_group_id        = aws_security_group.app.id
  source_security_group_id = aws_security_group.alb.id
}

resource "aws_lb_listener_rule" "acme_bridge" {
  count        = var.alb_acme_bridge ? 1 : 0
  listener_arn = aws_lb_listener.http.arn
  priority     = 1

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.acme_bridge[0].arn
  }

  condition {
    path_pattern {
      values = ["/.well-known/acme-challenge/*"]
    }
  }

  condition {
    host_header {
      values = ["app.tumi-ai.com", "api.tumi-ai.com"]
    }
  }

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}
