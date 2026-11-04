# Wildcard certificates by DNS-01 without handing over the DNS zone (docs/gateway/PLAN.md section 6, RUNBOOK-acme.md).
#
# EVERYTHING here is behind var.acme_enabled (default false => count 0 => merging this file changes nothing).
#
# How it works: the owner (Namecheap) delegates ONLY two names by CNAME and one subzone by NS:
#   _acme-challenge.apps.<parent>  CNAME  apps.acme.<parent>.
#   _acme-challenge.db.<parent>    CNAME  db.acme.<parent>.
#   acme.<parent>                  NS     (the 4 name servers of the zone below)
# Let's Encrypt follows the CNAME and reads the TXT that lego writes in this Route53 zone. Nothing else of <parent> is reachable.
#
# No long-lived key: the host already runs with the instance profile role `capsule-builder`. That role gets ONE extra
# permission (sts:AssumeRole on the role below); the role below can only write TXT records named apps.acme.<parent> and
# db.acme.<parent> in this one zone. acme-issue.sh assumes it for 15 minutes per run. Nothing is stored in .env or on disk.
# The builder role is not modified: the new inline policy is a separate resource.

variable "acme_enabled" {
  description = "Create the Route53 zone and the minimal IAM role used to issue the wildcard certificates by DNS-01. false = nothing is created."
  type        = bool
  default     = false
}

variable "acme_parent_zone" {
  description = "Domain whose _acme-challenge names the owner delegates (the zone is acme.<this>)."
  type        = string
  default     = "tumi-ai.com"
}

variable "acme_labels" {
  description = "Wildcard families: one TXT name <label>.acme.<parent> and one CNAME _acme-challenge.<label>.<parent> each."
  type        = list(string)
  default     = ["apps", "db"]
}

locals {
  acme       = var.acme_enabled ? 1 : 0
  acme_zone  = "acme.${var.acme_parent_zone}"
  acme_names = [for l in var.acme_labels : "${l}.${local.acme_zone}"]
}

resource "aws_route53_zone" "acme" {
  count   = local.acme
  name    = local.acme_zone
  comment = "DNS-01 delegation target for the wildcard certificates (apps, db). Written only by the capsule-acme role."

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

# Role assumed by the host (builder instance profile role) only.
resource "aws_iam_role" "acme" {
  count                = local.acme
  name                 = "${var.app_name}-acme"
  description          = "Writes DNS-01 TXT records in ${local.acme_zone} for lego"
  max_session_duration = 3600

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { AWS = aws_iam_role.builder.arn }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = {
    Environment = var.environment
    ManagedBy   = "terraform"
    Project     = "capsule"
  }
}

resource "aws_iam_role_policy" "acme" {
  count = local.acme
  name  = "dns01-txt-only"
  role  = aws_iam_role.acme[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # The only write: TXT records with exactly these names, in this zone. Names are normalized (lower case, no trailing dot).
        Sid      = "WriteChallengeTxtOnly"
        Effect   = "Allow"
        Action   = "route53:ChangeResourceRecordSets"
        Resource = aws_route53_zone.acme[0].arn
        Condition = {
          "ForAllValues:StringEquals" = {
            "route53:ChangeResourceRecordSetsNormalizedRecordNames" = local.acme_names
            "route53:ChangeResourceRecordSetsRecordTypes"           = ["TXT"]
            "route53:ChangeResourceRecordSetsActions"               = ["UPSERT", "DELETE"]
          }
        }
      },
      {
        # lego polls the change until INSYNC and may list the zone's records; read-only.
        Sid      = "ReadZone"
        Effect   = "Allow"
        Action   = ["route53:ListResourceRecordSets", "route53:GetHostedZone"]
        Resource = aws_route53_zone.acme[0].arn
      },
      {
        Sid      = "PollChange"
        Effect   = "Allow"
        Action   = "route53:GetChange"
        Resource = "arn:aws:route53:::change/*"
      }
    ]
  })
}

# The host may assume ONLY this role.
resource "aws_iam_role_policy" "builder_assume_acme" {
  count = local.acme
  name  = "assume-acme-role"
  role  = aws_iam_role.builder.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "AssumeAcme"
      Effect   = "Allow"
      Action   = "sts:AssumeRole"
      Resource = aws_iam_role.acme[0].arn
    }]
  })
}

output "acme_zone_id" {
  description = "Hosted zone id (AWS_HOSTED_ZONE_ID for acme-issue.sh, ACME_ZONE_ID in gateway acme.env)."
  value       = var.acme_enabled ? aws_route53_zone.acme[0].zone_id : null
}

output "acme_role_arn" {
  description = "Role the host assumes (ACME_ROLE_ARN in acme.env)."
  value       = var.acme_enabled ? aws_iam_role.acme[0].arn : null
}

output "acme_ns_records" {
  description = "The 4 NS values for the Namecheap NS records of host `acme` (zone acme.<parent>)."
  value       = var.acme_enabled ? sort(aws_route53_zone.acme[0].name_servers) : null
}

output "acme_cname_records" {
  description = "The CNAME records the owner creates in Namecheap (host => value), one per wildcard family."
  value = var.acme_enabled ? {
    for l in var.acme_labels : "_acme-challenge.${l}" => "${l}.${local.acme_zone}."
  } : null
}
