# IPv6 dual stack for the Capsule host and its ALB (opt-in; docs/ipv6.md has the procedure and rollback).
#
# EVERYTHING here is behind var.ipv6_enabled (default false => count 0 => the production network is
# NOT changed by merging this file). Never `terraform apply` it without reading docs/ipv6.md: it changes
# the default VPC (new IPv6 CIDR, subnets, route) and the ALB address type.
#
# Two one-line hooks live in existing files and are no-ops while ipv6_enabled = false:
#   alb.tf            aws_lb.capsule.ip_address_type   = var.ipv6_enabled ? "dualstack" : "ipv4"
#   security_groups.tf aws_security_group.alb ingress 80/443 get ipv6_cidr_blocks = var.ipv6_enabled ? ["::/0"] : []
# (the ALB SG rules are inline there: mixing them with standalone rules makes Terraform fight itself).

variable "ipv6_enabled" {
  description = "Dual stack: IPv6 CIDR on the default VPC, /64 per default subnet, ::/0 route, IPv6 on the host, dualstack ALB, IPv6 SG rules. false = nothing is created."
  type        = bool
  default     = false
}

variable "admin_ssh_ipv6_cidrs" {
  description = "IPv6 CIDRs allowed to reach the administration SSH on 2200 (only with git_enabled). Empty = no IPv6 admin access."
  type        = list(string)
  default     = []
}

locals {
  ipv6 = var.ipv6_enabled ? 1 : 0
}

# 1) Amazon-provided /56 on the default VPC (cannot be removed once subnets use it: see rollback in docs/ipv6.md).
resource "aws_vpc_ipv6_cidr_block_association" "default" {
  count                            = local.ipv6
  vpc_id                           = data.aws_vpc.default.id
  assign_generated_ipv6_cidr_block = true
}

# 2) One /64 per default subnet. Default subnets are not created by Terraform: aws_default_subnet ADOPTS the
#    existing one of each AZ (it is never destroyed by Terraform, destroy only drops it from state).
#    Import is implicit: the first apply adopts it. If the plan shows any change other than
#    ipv6_cidr_block / assign_ipv6_address_on_creation, STOP and reconcile the attributes first.
resource "aws_default_subnet" "dual" {
  for_each                        = var.ipv6_enabled ? toset(data.aws_availability_zones.available.names) : toset([])
  availability_zone               = each.key
  ipv6_cidr_block                 = cidrsubnet(aws_vpc_ipv6_cidr_block_association.default[0].ipv6_cidr_block, 8, index(data.aws_availability_zones.available.names, each.key))
  assign_ipv6_address_on_creation = true
  map_public_ip_on_launch         = true
}

# 3) ::/0 -> Internet gateway on the main route table (an aws_route never removes other routes, unlike aws_default_route_table).
data "aws_internet_gateway" "default" {
  count = local.ipv6
  filter {
    name   = "attachment.vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

data "aws_route_table" "main" {
  count  = local.ipv6
  vpc_id = data.aws_vpc.default.id
  filter {
    name   = "association.main"
    values = ["true"]
  }
}

resource "aws_route" "ipv6_default" {
  count                       = local.ipv6
  route_table_id              = data.aws_route_table.main[0].id
  destination_ipv6_cidr_block = "::/0"
  gateway_id                  = data.aws_internet_gateway.default[0].id
}

# 4) IPv6 address on the existing host WITHOUT replacing it. aws_instance.builder has ignore_changes = [ami, user_data],
#    but adding ipv6_address_count there is also an in-place update; this separate resource avoids touching ec2.tf.
#    AssignIpv6Addresses on the primary ENI is online (no reboot). Needs the subnet to have its /64 (step 2).
resource "terraform_data" "builder_ipv6" {
  count      = local.ipv6
  depends_on = [aws_default_subnet.dual, aws_route.ipv6_default]
  input = {
    eni    = aws_instance.builder.primary_network_interface_id
    region = var.aws_region
  }
  provisioner "local-exec" {
    command = "aws ec2 assign-ipv6-addresses --region ${self.input.region} --network-interface-id ${self.input.eni} --ipv6-address-count 1"
  }
  # Reversal is manual and explicit (docs/ipv6.md): unassigning needs the concrete address.
}

data "aws_network_interface" "builder" {
  count      = local.ipv6
  id         = aws_instance.builder.primary_network_interface_id
  depends_on = [terraform_data.builder_ipv6]
}

# 5) Security group rules (NEW, separate; the `app` SG has ignore_changes = [ingress] so they are not reverted).
#    Database / extra-port rules (capsule:db:/capsule:port:) are managed by the API, also for IPv6.
resource "aws_security_group_rule" "ipv6_ssh_git" {
  count             = local.ipv6
  type              = "ingress"
  description       = "Forgejo SSH (22) over IPv6"
  from_port         = 22
  to_port           = 22
  protocol          = "tcp"
  security_group_id = aws_security_group.app.id
  ipv6_cidr_blocks  = ["::/0"]
}

resource "aws_security_group_rule" "ipv6_http" {
  count             = var.ipv6_enabled && var.git_enabled ? 1 : 0
  type              = "ingress"
  description       = "Caddy: ACME HTTP-01 and redirect (IPv6)"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  security_group_id = aws_security_group.app.id
  ipv6_cidr_blocks  = ["::/0"]
}

resource "aws_security_group_rule" "ipv6_https" {
  count             = var.ipv6_enabled && var.git_enabled ? 1 : 0
  type              = "ingress"
  description       = "Caddy: HTTPS (IPv6)"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.app.id
  ipv6_cidr_blocks  = ["::/0"]
}

resource "aws_security_group_rule" "ipv6_admin_ssh" {
  count             = var.ipv6_enabled && var.git_enabled && length(var.admin_ssh_ipv6_cidrs) > 0 ? 1 : 0
  type              = "ingress"
  description       = "Server administration SSH (2200) over IPv6"
  from_port         = 2200
  to_port           = 2200
  protocol          = "tcp"
  security_group_id = aws_security_group.app.id
  ipv6_cidr_blocks  = var.admin_ssh_ipv6_cidrs
}

# 6) Outputs for the DNS records (the owner adds them; nothing is applied to DNS from here).
output "builder_ipv6" {
  description = "IPv6 address of the host: create AAAA records for git and db with this value"
  value       = var.ipv6_enabled ? try(tolist(data.aws_network_interface.builder[0].ipv6_addresses)[0], null) : null
}

output "alb_dns_name_dualstack" {
  description = "ALB DNS name; with ip_address_type=dualstack it resolves to A and AAAA (Namecheap: CNAME *.apps to this name)"
  value       = var.ipv6_enabled ? aws_lb.capsule.dns_name : null
}
