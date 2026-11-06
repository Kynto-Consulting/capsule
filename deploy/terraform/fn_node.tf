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

# 06-nov-2026: movido a la Local Zone de Lima (us-east-1-lim-1, grupo propio dentro de us-east-1, requiere opt-in) para
# que el nodo salga con una IP de Perú: el FortiGate del estudio puede entonces aceptarlo sin que su TI abra nada hacia
# una IP de Virginia. Sigue siendo la misma VPC/cuenta; solo cambia la subred. Costo y catálogo de tipos de instancia
# son distintos de la región "normal" (ver docs/vpn-connector-operacion.md): sin Spot (las Local Zones normalmente no
# lo ofrecen) y con sobrecosto de on-demand frente a us-east-1.
resource "aws_ec2_availability_zone_group" "lima" {
  count         = local.fn_node_count
  group_name    = "us-east-1-lim-1"
  opt_in_status = "opted-in"
}

resource "aws_subnet" "fn_node_lima" {
  count                   = local.fn_node_count
  vpc_id                  = data.aws_vpc.default.id
  availability_zone       = "us-east-1-lim-1a"
  cidr_block              = "172.31.96.0/24" # libre: las subredes del default VPC solo usan 172.31.{0,16,32,48,64,80}.0/20
  map_public_ip_on_launch = true
  depends_on              = [aws_ec2_availability_zone_group.lima]
  tags                    = { Name = "${var.app_name}-fn-node-lima", ManagedBy = "terraform", Component = "fn-node" }
}

# IP fija: antes el nodo perdía su IP pública cada vez que el Spot se detenía por interrupción y volvía a arrancar,
# lo que habría roto cualquier regla de la TI del estudio basada en IP. Una Elastic IP no cambia mientras exista el recurso.
resource "aws_eip" "fn_node" {
  count  = local.fn_node_count
  domain = "vpc"
  tags   = { Name = "${var.app_name}-fn-node", ManagedBy = "terraform", Component = "fn-node" }
}

resource "aws_eip_association" "fn_node" {
  count         = local.fn_node_count
  instance_id   = aws_instance.fn_node[0].id
  allocation_id = aws_eip.fn_node[0].id
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
  subnet_id                   = aws_subnet.fn_node_lima[0].id
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

  # On-demand: las Local Zones normalmente no ofrecen mercado Spot (no había tipos de instancia listados en
  # us-east-1-lim-1a antes del opt-in); además una interrupción Spot habría tirado el túnel FortiGate justo
  # cuando el estudio ya confía en esta IP fija.

  user_data_replace_on_change = true
  user_data                   = <<-EOT
    #!/bin/bash
    set -euo pipefail
    dnf install -y docker iproute iptables git gcc make automake autoconf libtool pkgconfig openssl-devel tar gzip
    systemctl enable --now docker
    mkdir -p /opt/capsule /run/capsule/fn

    # pppd: openfortivpn needs it to bring the tunnel interface up, and AL2023 does not package it either (06-nov-2026: the first
    # real run failed with "tunnel interface did not come up"). Built from the ppp project (v2.5.1); the kernel modules exist.
    if ! command -v pppd >/dev/null; then
      curl -fsSL -o /tmp/ppp.tgz https://github.com/ppp-project/ppp/archive/refs/tags/v2.5.1.tar.gz
      cd /tmp && tar xzf ppp.tgz && cd ppp-2.5.1 && ./autogen.sh && ./configure --prefix=/usr --sysconfdir=/etc && make -j2 && make install
      cd / && rm -rf /tmp/ppp-2.5.1 /tmp/ppp.tgz
    fi
    printf '%s
' ppp_generic ppp_async ppp_deflate > /etc/modules-load.d/ppp.conf
    modprobe ppp_generic && modprobe ppp_async
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

output "fn_node_static_ip" {
  description = "IP fija del nodo (dásela a la TI del estudio para su regla del FortiGate)."
  value       = try(aws_eip.fn_node[0].public_ip, null)
}
