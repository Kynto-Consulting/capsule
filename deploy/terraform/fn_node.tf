# Work node of Capsule functions (docs/vpn-connector.md, docs/vpn-connector-operacion.md). Everything is count = 0 unless
# var.fn_node_enabled = true. No inbound traffic (SSM only); egress open because tunnels use UDP/TCP ports chosen by the customer.
# Spot t3.small, stop on interruption; it runs the agent (outbound calls to the Capsule API) and tunnel gateways, never builds.
variable "fn_node_enabled" {
  type    = bool
  default = false
}

variable "fn_node_instance_type" {
  type    = string
  default = "t3.small"
}

variable "fn_node_token_param" {
  description = "SSM parameter (SecureString) with the capnode_ token printed by `server fn-node <name>`."
  type        = string
  default     = "/capsule/fn-node/token"
}

variable "fn_node_api_url" {
  type    = string
  default = "https://api.tumi-ai.com"
}

locals {
  fn_node_count     = var.fn_node_enabled ? 1 : 0
  fn_node_param_arn = "arn:aws:ssm:${var.aws_region}:${var.aws_account_id}:parameter${startswith(var.fn_node_token_param, "/") ? "" : "/"}${var.fn_node_token_param}"
}

resource "aws_iam_role" "fn_node" {
  count              = local.fn_node_count
  name               = "${var.app_name}-fn-node"
  assume_role_policy = data.aws_iam_policy_document.ci_runner_assume.json
  tags               = { ManagedBy = "terraform", Component = "fn-node" }
}

resource "aws_iam_role_policy_attachment" "fn_node_ssm" {
  count      = local.fn_node_count
  role       = aws_iam_role.fn_node[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

data "aws_iam_policy_document" "fn_node" {
  statement {
    sid       = "ReadNodeToken"
    actions   = ["ssm:GetParameter"]
    resources = [local.fn_node_param_arn]
  }
  statement {
    sid       = "ReadAgentBinary"
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.artifacts.arn}/deploy/capsule-fn-agent.gz"]
  }
}

resource "aws_iam_role_policy" "fn_node" {
  count  = local.fn_node_count
  name   = "fn-node-read"
  role   = aws_iam_role.fn_node[0].id
  policy = data.aws_iam_policy_document.fn_node.json
}

resource "aws_iam_instance_profile" "fn_node" {
  count = local.fn_node_count
  name  = "${var.app_name}-fn-node"
  role  = aws_iam_role.fn_node[0].name
}

resource "aws_security_group" "fn_node" {
  count       = local.fn_node_count
  name        = "${var.app_name}-fn-node"
  description = "Functions work node: no ingress"
  vpc_id      = data.aws_vpc.default.id

  egress {
    description = "outbound (API, registries, customer VPN endpoints)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${var.app_name}-fn-node", ManagedBy = "terraform", Component = "fn-node" }
}

resource "aws_instance" "fn_node" {
  count                       = local.fn_node_count
  ami                         = data.aws_ami.amazon_linux.id
  instance_type               = var.fn_node_instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.fn_node[0].id]
  iam_instance_profile        = aws_iam_instance_profile.fn_node[0].name
  associate_public_ip_address = true # egress only (no NAT in the default VPC); the SG has no ingress

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type           = "gp3"
    volume_size           = 8
    encrypted             = true
    delete_on_termination = true
  }

  instance_market_options {
    market_type = "spot"
    spot_options {
      spot_instance_type             = "persistent"
      instance_interruption_behavior = "stop"
    }
  }

  user_data_replace_on_change = true
  user_data                   = <<-EOT
    #!/bin/bash
    set -euo pipefail
    dnf install -y docker iproute iptables
    systemctl enable --now docker
    mkdir -p /opt/capsule /run/capsule/fn
    aws s3 cp s3://capsule-artifacts-${var.aws_account_id}/deploy/capsule-fn-agent.gz /opt/capsule/capsule-fn-agent.gz --region ${var.aws_region}
    gunzip -f /opt/capsule/capsule-fn-agent.gz && chmod 755 /opt/capsule/capsule-fn-agent
    cat >/etc/systemd/system/capsule-fn-agent.service <<UNIT
    [Unit]
    Description=Capsule functions work node
    After=docker.service network-online.target
    [Service]
    Environment=CAPSULE_API_URL=${var.fn_node_api_url}
    ExecStart=/bin/bash -c 'CAPSULE_NODE_TOKEN=$(aws ssm get-parameter --with-decryption --name ${var.fn_node_token_param} --region ${var.aws_region} --query Parameter.Value --output text) exec /opt/capsule/capsule-fn-agent'
    Restart=always
    RestartSec=5
    [Install]
    WantedBy=multi-user.target
    UNIT
    systemctl daemon-reload && systemctl enable --now capsule-fn-agent
  EOT

  tags = { Name = "${var.app_name}-fn-node", ManagedBy = "terraform", Component = "fn-node" }
}

output "fn_node_instance_id" {
  value = try(aws_instance.fn_node[0].id, null)
}
