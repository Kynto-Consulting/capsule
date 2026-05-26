# Aggregated outputs — individual resource outputs are defined in their own files.
# This file re-exports everything in one place for convenience.

output "summary" {
  description = "Key infrastructure values"
  value = {
    alb_dns_name         = aws_lb.capsule.dns_name
    ecr_registry_url     = "${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
    artifacts_bucket     = aws_s3_bucket.artifacts.bucket
    db_subnet_group      = aws_db_subnet_group.capsule.name
    rds_security_group   = aws_security_group.rds.id
    builder_public_ip    = aws_instance.builder.public_ip
    builder_instance_id  = aws_instance.builder.id
    api_access_key_id    = aws_iam_access_key.capsule_api.id
  }
}
