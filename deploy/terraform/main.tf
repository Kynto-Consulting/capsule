terraform {
  required_version = ">= 1.5"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.0" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Local backend for now — add S3 later
}

provider "aws" {
  region = var.aws_region
}

data "aws_vpc" "default" { default = true }

data "aws_availability_zones" "available" {
  state = "available"
  # Local Zones / Wavelength (opted in for fn_node.tf's Lima node) don't belong to this VPC's IPv6 network
  # border group and don't get a "default subnet" the normal way; excluding them keeps ipv6.tf's for_each
  # (and its per-AZ CIDR index) stable regardless of what gets opted into later (06-nov-2026).
  filter {
    name   = "zone-type"
    values = ["availability-zone"]
  }
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
  # Scoped to real AZs: without this, fn_node.tf's Lima subnet (a Local Zone) leaks into the RDS subnet
  # group, the ALB's fallback subnet list, the CI runner and the recovery drill (06-nov-2026) — none of
  # which should ever land a resource in a Local Zone. The Lima node uses its own subnet explicitly.
  filter {
    name   = "availability-zone"
    values = data.aws_availability_zones.available.names
  }
}
