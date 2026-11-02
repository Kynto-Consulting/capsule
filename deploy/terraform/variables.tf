variable "aws_region" {
  description = "AWS region to deploy resources into"
  type        = string
  default     = "us-east-1"
}

variable "aws_account_id" {
  description = "AWS account ID"
  type        = string
  default     = "598806201852"
}

variable "environment" {
  description = "Deployment environment name (e.g. production, staging)"
  type        = string
  default     = "production"
}

variable "app_name" {
  description = "Application name used in resource naming"
  type        = string
  default     = "capsule"
}

variable "alb_domain" {
  description = "Domain name for ALB Route53 alias. Leave empty to skip HTTPS listener."
  type        = string
  default     = ""
}

variable "db_instance_class" {
  description = "RDS instance class for provisioned databases"
  type        = string
  default     = "db.t3.micro"
}

variable "ec2_instance_type" {
  description = "EC2 instance type for app / builder servers"
  type        = string
  default     = "t3.small"
}

variable "key_pair_name" {
  description = "Name of the EC2 key pair to attach to instances"
  type        = string
  default     = "capsule-key"
}

variable "ec2_public_key" {
  description = "Public key material for the EC2 key pair. Leave empty if importing an existing key pair."
  type        = string
  default     = ""
  sensitive   = true
}

variable "alb_certificate_arn" {
  description = "ACM certificate ARN for the HTTPS listener. Required when alb_domain is non-empty."
  type        = string
  default     = ""
}

variable "db_allowed_cidrs" {
  description = "CIDRs allowed to reach the ports of databases provisioned by Capsule (docker host ports). Empty = not exposed."
  type        = list(string)
  default     = []
}

variable "db_port_from" {
  description = "First host port Capsule may publish databases on (CAPSULE_DB_PORT_RANGE)."
  type        = number
  default     = 40000
}

variable "db_port_to" {
  description = "Last host port Capsule may publish databases on."
  type        = number
  default     = 40199
}

variable "db_extra_ports" {
  description = "Individual host ports of databases created before the dedicated range existed."
  type        = list(number)
  default     = []
}
