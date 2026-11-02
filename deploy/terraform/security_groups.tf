resource "aws_security_group" "alb" {
  name        = "${var.app_name}-alb"
  description = "Allow HTTP/HTTPS traffic to the ALB"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP from anywhere"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS from anywhere"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.app_name}-alb"
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_security_group" "app" {
  name        = "${var.app_name}-app"
  description = "App servers: allow traffic from ALB and SSH"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Frontend from ALB"
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description     = "Backend API from ALB"
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  ingress {
    description = "SSH from anywhere"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Ingress also holds rules managed outside this resource (database port rules below and the ones
  # the Capsule API creates per project). Without this, every apply would revoke them.
  lifecycle {
    ignore_changes = [ingress]
  }

  tags = {
    Name        = "${var.app_name}-app"
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_security_group" "rds" {
  name        = "${var.app_name}-rds"
  description = "RDS: allow Postgres and MySQL from app servers only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "PostgreSQL from app servers"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  ingress {
    description     = "MySQL from app servers"
    from_port       = 3306
    to_port         = 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.app_name}-rds"
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_security_group" "redis" {
  name        = "${var.app_name}-redis"
  description = "ElastiCache Redis: allow 6379 from app servers only"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description     = "Redis from app servers"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.app_name}-redis"
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# Databases provisioned by Capsule run as containers on the app host. They are
# published only inside the dedicated range [db_port_from, db_port_to] (the
# backend picks ports there), never on docker's general ephemeral range where
# app containers live. The range is reachable only from var.db_allowed_cidrs and
# the host's own Elastic IP (the API queries databases through the public hostname).
# Per-database access for users is managed by the API (see APP_SECURITY_GROUP_ID), not here.
locals {
  db_sources = concat(var.db_allowed_cidrs, ["${aws_eip.builder.public_ip}/32"])
}

resource "aws_security_group_rule" "app_db_ports" {
  type              = "ingress"
  description       = "Capsule databases (dedicated port range; host itself + optional static CIDRs)"
  security_group_id = aws_security_group.app.id
  protocol          = "tcp"
  from_port         = var.db_port_from
  to_port           = var.db_port_to
  cidr_blocks       = local.db_sources
}

resource "aws_security_group_rule" "app_db_extra_ports" {
  for_each          = toset([for p in var.db_extra_ports : tostring(p)])
  type              = "ingress"
  description       = "Capsule database published before the dedicated range (port ${each.value})"
  security_group_id = aws_security_group.app.id
  protocol          = "tcp"
  from_port         = tonumber(each.value)
  to_port           = tonumber(each.value)
  cidr_blocks       = local.db_sources
}
