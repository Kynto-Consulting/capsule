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
  statement {
    # `fn.Spec.Image` is whatever the user deployed with `capsule fn deploy`; when it is one of this
    # account's own ECR repos (not Docker Hub or another public registry), the node must authenticate
    # before `docker run` can pull it. GetAuthorizationToken has no resource-level permissions (AWS
    # always returns InvalidParameterException "*" is required), so it must stay unscoped.
    sid       = "ECRAuth"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }
  statement {
    sid       = "ECRPull"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
    resources = ["arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/*"]
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
    volume_size           = 30 # the AMI's root snapshot requires at least this much
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
    dnf install -y docker iproute iptables git gcc make automake autoconf pkgconfig openssl-devel
    systemctl enable --now docker
    mkdir -p /opt/capsule /run/capsule/fn

    # openfortivpn: not in the AL2023 repos (EPEL/Fedora/Debian only), so build it once at launch.
    # kernel.go shells out to the "openfortivpn" binary by name; it must land on PATH (/usr/local/bin).
    if ! command -v openfortivpn >/dev/null; then
      git clone --depth 1 https://github.com/adrienverge/openfortivpn.git /opt/openfortivpn-src
      cd /opt/openfortivpn-src && ./autogen.sh && ./configure --prefix=/usr/local && make -j2 && make install
      cd / && rm -rf /opt/openfortivpn-src
    fi

    aws s3 cp s3://capsule-artifacts-${var.aws_account_id}/deploy/capsule-fn-agent.gz /opt/capsule/capsule-fn-agent.gz --region ${var.aws_region}
    gunzip -f /opt/capsule/capsule-fn-agent.gz && chmod 755 /opt/capsule/capsule-fn-agent

    # Function images may live in this account's own ECR (capsule fn deploy --image <acct>.dkr.ecr...): refresh the
    # docker login before the 12h token expires. A function image on Docker Hub or another public registry needs
    # none of this; `docker run` already pulls those without any login.
    cat >/etc/systemd/system/capsule-ecr-login.service <<UNIT
    [Unit]
    Description=Refresh this node's docker login to this account's ECR
    [Service]
    Type=oneshot
    ExecStart=/bin/bash -c 'aws ecr get-login-password --region ${var.aws_region} | docker login --username AWS --password-stdin ${var.aws_account_id}.dkr.ecr.${var.aws_region}.amazonaws.com'
    UNIT
    cat >/etc/systemd/system/capsule-ecr-login.timer <<UNIT
    [Unit]
    Description=Run capsule-ecr-login every 6 hours
    [Timer]
    OnBootSec=30
    OnUnitActiveSec=6h
    [Install]
    WantedBy=timers.target
    UNIT
    systemctl daemon-reload && systemctl enable --now capsule-ecr-login.timer

    # 'UNIT' entre comillas: sin ellas bash expandía $(aws ssm get-parameter ...) al crear el nodo, antes de existir el token, y
    # la unidad quedaba con CAPSULE_NODE_TOKEN= vacío (06-nov-2026). Las variables var.* las resuelve Terraform antes, no bash.
    cat >/etc/systemd/system/capsule-fn-agent.service <<'UNIT'
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
