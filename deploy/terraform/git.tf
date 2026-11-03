# Network plumbing for the core service `git` (Forgejo + Caddy, docker-compose.prod.yml). PLAN B:
# no NLB, no ACM certificate, no ALB rule. git.tumi-ai.com is an A record straight to the server's
# Elastic IP; Caddy on the host terminates TLS (Let's Encrypt, HTTP-01) and proxies to Forgejo.
#
# NOTHING here exists unless var.git_enabled = true. These are NEW rules on the `app` security group;
# the SG itself (ignore_changes = [ingress]) is not touched.
#
#   22/tcp   Forgejo SSH (git over ssh). The inline "SSH from anywhere" rule on port 22 that already
#            exists in security_groups.tf is, from now on, the Forgejo SSH port; it is NOT re-declared here.
#   80/tcp   Caddy (ACME HTTP-01 challenge + redirect to HTTPS)
#   443/tcp  Caddy (HTTPS for git.tumi-ai.com)
#   2200/tcp server administration SSH (key authentication only). See deploy/forgejo/move-admin-ssh.sh.
#
# Ports 80/443 on the host were previously unused by the app SG (the ALB reaches 3000/8080), so no overlap.

resource "aws_security_group_rule" "git_http" {
  count             = var.git_enabled ? 1 : 0
  type              = "ingress"
  description       = "Caddy: ACME HTTP-01 and redirect"
  from_port         = 80
  to_port           = 80
  protocol          = "tcp"
  security_group_id = aws_security_group.app.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "git_https" {
  count             = var.git_enabled ? 1 : 0
  type              = "ingress"
  description       = "Caddy: HTTPS for git.tumi-ai.com"
  from_port         = 443
  to_port           = 443
  protocol          = "tcp"
  security_group_id = aws_security_group.app.id
  cidr_blocks       = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "git_admin_ssh" {
  count             = var.git_enabled ? 1 : 0
  type              = "ingress"
  description       = "Server administration SSH (moved from 22 to 2200)"
  from_port         = 2200
  to_port           = 2200
  protocol          = "tcp"
  security_group_id = aws_security_group.app.id
  cidr_blocks       = var.admin_ssh_cidrs
}

output "git_dns_record" {
  description = "The only DNS record the user must create in Namecheap: A git -> this Elastic IP (TTL automatic)"
  value       = var.git_enabled ? "A  git  ${aws_eip.builder.public_ip}" : null
}
