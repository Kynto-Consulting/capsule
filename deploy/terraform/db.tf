# PostgreSQL that holds Capsule's own state (orgs, projects, deployments).
# Not to be confused with the per-project databases Capsule provisions itself.

resource "random_password" "capsule_db" {
  length  = 32
  special = false
}

resource "aws_db_instance" "capsule" {
  identifier             = "${var.app_name}-db"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = var.db_instance_class
  allocated_storage      = 20
  storage_type           = "gp3"
  storage_encrypted      = true
  db_name                = "capsule"
  username               = "capsule"
  password               = random_password.capsule_db.result
  db_subnet_group_name   = aws_db_subnet_group.capsule.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false

  backup_retention_period   = 7
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.app_name}-db-final"
  deletion_protection       = true

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

output "capsule_database_url" {
  description = "DATABASE_URL for the Capsule backend"
  sensitive   = true
  value       = "postgresql://capsule:${random_password.capsule_db.result}@${aws_db_instance.capsule.address}:5432/capsule?sslmode=require"
}
