resource "aws_db_subnet_group" "capsule" {
  name        = "${var.app_name}-db-subnet-group"
  description = "Subnet group for Capsule RDS instances (default VPC)"
  subnet_ids  = data.aws_subnets.default.ids

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_db_option_group" "mysql8" {
  name                     = "${var.app_name}-mysql8"
  option_group_description = "Capsule option group for MySQL 8.0"
  engine_name              = "mysql"
  major_engine_version     = "8.0"

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

output "db_subnet_group_name" {
  description = "Name of the RDS DB subnet group"
  value       = aws_db_subnet_group.capsule.name
}

output "rds_security_group_id" {
  description = "ID of the RDS security group"
  value       = aws_security_group.rds.id
}
