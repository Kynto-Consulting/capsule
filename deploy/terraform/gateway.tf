# Universal gateway (docs/gateway/PLAN.md): security group rules for the gateway's public ports.
#
# EVERYTHING here is behind var.gateway_enabled (default false => count 0 => merging this file changes nothing).
# Do not `terraform apply` it without reading docs/gateway/RUNBOOK-ipv6.md and docs/gateway/RUNBOOK-dns.md.
#
# Why a separate file and standalone aws_security_group_rule resources: the `app` security group has
# lifecycle.ignore_changes = [ingress] (security_groups.tf), so standalone rules are neither reverted nor
# do they fight the inline rules; this is the same pattern as ipv6.tf.
#
# How these rules coexist with the API reconciler (backend/internal/netaccess):
#   * reconcile.go (DescPrefix "capsule:db:") and ports.go (PortDescPrefix "capsule:port:") only ever
#     revoke rules whose description STARTS WITH those prefixes (Diff / DiffPorts: `if !ok { continue }`).
#   * ec2adapter.go ListIngressRules additionally skips every rule that is not a single-port TCP rule
#     (FromPort != ToPort), so the pool RANGE rule below is not even listed to the reconciler.
#   * Our descriptions start with "capsule:gwpool" / "capsule:gwstd:" / "capsule:gwtest" / "capsule:gwudp":
#     none starts with "capsule:db:" or "capsule:port:", so the reconciler never touches, counts or revokes them.
#   Do not rename a description to start with one of those two prefixes.
#
# Source policy (PLAN.md sections 3.4 and 5.2): the gateway applies the per-project IP list in user space
# (same single list as the direct ports, internal/netaccess), so the PUBLIC gateway ports are open to the
# Internet at the security group and the decision is made per connection by the gateway. The test port
# is the exception: it is only opened to explicit CIDRs.
#
# Rule budget: each rule counts once per address family against the AWS default of 60 inbound rules per
# security group (ajustable). This file adds, per family: 1 (pool) + len(gateway_standard_ports)
# + 1 (test port, if CIDRs are given) + 1 (UDP 443, if enabled) = 5 by default.

variable "gateway_enabled" {
  description = "Create the security group rules of the universal gateway (pool, standard ports). false = nothing is created."
  type        = bool
  default     = false
}

variable "gateway_pool_from" {
  description = "First port of the random-port pool (CAPSULE_GW_PORT_POOL, PLAN.md 3.4). Must not overlap 40000-41999 (direct ports)."
  type        = number
  default     = 20000

  validation {
    condition     = var.gateway_pool_from >= 1024 && var.gateway_pool_from < 40000
    error_message = "gateway_pool_from must be >= 1024 and < 40000 (40000-41999 belong to the direct ports)."
  }
}

variable "gateway_pool_to" {
  description = "Last port of the random-port pool."
  type        = number
  default     = 29999

  validation {
    condition     = var.gateway_pool_to < 40000
    error_message = "gateway_pool_to must be < 40000 (40000-41999 belong to the direct ports)."
  }
}

variable "gateway_standard_ports" {
  description = "Standard TCP ports the gateway listens on for SNI routing (PostgreSQL, MySQL, Redis TLS, MongoDB TLS). 443 is NOT here: it already has a rule (git_enabled)."
  type        = list(number)
  default     = [5432, 3306, 6379, 27017]
}

variable "gateway_public_cidrs" {
  description = "IPv4 CIDRs allowed to reach the pool and the standard ports. The gateway applies the per-project IP list itself, so the default is the whole Internet."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "gateway_ipv6_rules" {
  description = "Also create the ::/0 rules for the gateway ports. Harmless while the host has no IPv6 (nobody can reach it), required once ipv6_enabled is applied."
  type        = bool
  default     = true
}

variable "gateway_test_port" {
  description = "Port of the gateway used during phase F1 (443 is not touched yet, PLAN.md 4.3/12.2)."
  type        = number
  default     = 8443
}

variable "gateway_test_cidrs" {
  description = "IPv4 CIDRs allowed to reach the test port. Empty = no rule (recommended: your own /32 only)."
  type        = list(string)
  default     = []
}

variable "gateway_test_ipv6_cidrs" {
  description = "IPv6 CIDRs allowed to reach the test port. Empty = no IPv6 rule."
  type        = list(string)
  default     = []
}

variable "gateway_udp_enabled" {
  description = "UDP/443 for QUIC (phase F3, PLAN.md 5.3). false = no rule."
  type        = bool
  default     = false
}

locals {
  gw          = var.gateway_enabled ? 1 : 0
  gw_ports    = var.gateway_enabled ? toset([for p in var.gateway_standard_ports : tostring(p)]) : toset([])
  gw_v6       = var.gateway_ipv6_rules ? ["::/0"] : []
  gw_test     = var.gateway_enabled && length(var.gateway_test_cidrs) + length(var.gateway_test_ipv6_cidrs) > 0 ? 1 : 0
  gw_udp      = var.gateway_enabled && var.gateway_udp_enabled ? 1 : 0
  gw_pool_str = "${var.gateway_pool_from}-${var.gateway_pool_to}"
}

# 1) ONE rule for the whole random-port pool (a rule per project would exhaust the 60-rule quota).
#    The gateway only listens on leased ports; everything else in the range is closed by the kernel (RST).
resource "aws_security_group_rule" "gw_pool" {
  count             = local.gw
  type              = "ingress"
  description       = "capsule:gwpool"
  from_port         = var.gateway_pool_from
  to_port           = var.gateway_pool_to
  protocol          = "tcp"
  security_group_id = aws_security_group.app.id
  cidr_blocks       = var.gateway_public_cidrs
  ipv6_cidr_blocks  = local.gw_v6

  lifecycle {
    precondition {
      condition     = var.gateway_pool_from <= var.gateway_pool_to
      error_message = "gateway_pool_from must be <= gateway_pool_to."
    }
  }
}

# 1b) The same pool over UDP: the gateway opens UDP flows on leased ports (docs/gateway/RUNBOOK-udp-pool.md). One rule too.
resource "aws_security_group_rule" "gw_pool_udp" {
  count             = local.gw
  type              = "ingress"
  description       = "capsule:gwpoolu"
  from_port         = var.gateway_pool_from
  to_port           = var.gateway_pool_to
  protocol          = "udp"
  security_group_id = aws_security_group.app.id
  cidr_blocks       = var.gateway_public_cidrs
  ipv6_cidr_blocks  = local.gw_v6
}

# 2) Standard ports (SNI routing by name): one rule each, IPv4 and IPv6 in the same resource.
resource "aws_security_group_rule" "gw_standard" {
  for_each          = local.gw_ports
  type              = "ingress"
  description       = "capsule:gwstd:${each.key}"
  from_port         = tonumber(each.key)
  to_port           = tonumber(each.key)
  protocol          = "tcp"
  security_group_id = aws_security_group.app.id
  cidr_blocks       = var.gateway_public_cidrs
  ipv6_cidr_blocks  = local.gw_v6
}

# 3) Test port (F1): only for explicit CIDRs.
resource "aws_security_group_rule" "gw_test" {
  count             = local.gw_test
  type              = "ingress"
  description       = "capsule:gwtest"
  from_port         = var.gateway_test_port
  to_port           = var.gateway_test_port
  protocol          = "tcp"
  security_group_id = aws_security_group.app.id
  cidr_blocks       = length(var.gateway_test_cidrs) > 0 ? var.gateway_test_cidrs : null
  ipv6_cidr_blocks  = length(var.gateway_test_ipv6_cidrs) > 0 ? var.gateway_test_ipv6_cidrs : null
}

# 4) UDP/443 (QUIC tunnel, F3). Off by default.
resource "aws_security_group_rule" "gw_udp" {
  count             = local.gw_udp
  type              = "ingress"
  description       = "capsule:gwudp"
  from_port         = 443
  to_port           = 443
  protocol          = "udp"
  security_group_id = aws_security_group.app.id
  cidr_blocks       = var.gateway_public_cidrs
  ipv6_cidr_blocks  = local.gw_v6
}

# Outputs: what the owner needs for DNS (docs/gateway/RUNBOOK-dns.md) and to double-check the rules.
output "gateway_dns_ipv4" {
  description = "IPv4 for the A records of tcp / udp / *.db (and *.apps if the gateway serves it): the Elastic IP of the host."
  value       = var.gateway_enabled ? aws_eip.builder.public_ip : null
}

output "gateway_dns_ipv6" {
  description = "IPv6 for the AAAA records of tcp / udp / *.db. null until the host has its IPv6 (ipv6.tf)."
  value       = var.gateway_enabled ? try(tolist(aws_instance.builder.ipv6_addresses)[0], null) : null
}

output "gateway_open_ports" {
  description = "Ports the gateway rules open (TCP unless noted). 443 and 22 are managed elsewhere."
  value = var.gateway_enabled ? {
    pool      = local.gw_pool_str
    standard  = sort([for p in var.gateway_standard_ports : tostring(p)])
    test_port = local.gw_test == 1 ? var.gateway_test_port : null
    udp_443   = local.gw_udp == 1
  } : null
}
