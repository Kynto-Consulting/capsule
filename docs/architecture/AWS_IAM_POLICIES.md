# Capsule — AWS IAM Policies

> **Version:** 1.0.0-draft  
> **Last Updated:** 2026-05-26  
> **AWS Regions:** us-east-1 (default), configurable  
> **Security Level:** Least-privilege by design

---

## Table of Contents

1. [Overview](#1-overview)
2. [Minimum Required Policy](#2-minimum-required-policy)
3. [Service-by-Service Breakdown](#3-service-by-service-breakdown)
4. [Security Best Practices](#4-security-best-practices)
5. [Deployment Scenario Policies](#5-deployment-scenario-policies)
6. [Cross-Account Access](#6-cross-account-access)
7. [Instance Profile Setup](#7-instance-profile-setup)
8. [Policy Validation](#8-policy-validation)

---

## 1. Overview

Capsule requires an AWS IAM identity (user, role, or instance profile) to provision and manage AWS resources. This document defines the **minimum required permissions** following the principle of least privilege.

### Resource Naming Convention

All Capsule-managed resources use the prefix `capsule-*` in their names/tags. IAM policies use `Condition` blocks and resource ARN patterns to scope permissions to Capsule-managed resources only.

### Recommended Setup

| Environment | IAM Type | Description |
|---|---|---|
| **EC2 (production)** | Instance Profile + IAM Role | Best security, no static keys |
| **Local dev/CLI** | IAM User + API Keys | For development and testing only |
| **CI/CD** | OIDC Federation | GitHub Actions, GitLab CI |
| **Multi-account** | Cross-account Role Assumption | Separate staging/production accounts |

---

## 2. Minimum Required Policy

This is the complete, unified IAM policy for Capsule. Apply it to the IAM role or user that Capsule will use.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EC2Management",
      "Effect": "Allow",
      "Action": [
        "ec2:RunInstances",
        "ec2:TerminateInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:RebootInstances",
        "ec2:DescribeInstances",
        "ec2:DescribeInstanceStatus",
        "ec2:DescribeImages",
        "ec2:DescribeKeyPairs",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSubnets",
        "ec2:DescribeVpcs",
        "ec2:DescribeAvailabilityZones",
        "ec2:DescribeVolumes",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DescribeAddresses",
        "ec2:CreateSecurityGroup",
        "ec2:DeleteSecurityGroup",
        "ec2:AuthorizeSecurityGroupIngress",
        "ec2:AuthorizeSecurityGroupEgress",
        "ec2:RevokeSecurityGroupIngress",
        "ec2:RevokeSecurityGroupEgress",
        "ec2:CreateTags",
        "ec2:DeleteTags",
        "ec2:CreateVolume",
        "ec2:DeleteVolume",
        "ec2:AttachVolume",
        "ec2:DetachVolume",
        "ec2:AllocateAddress",
        "ec2:ReleaseAddress",
        "ec2:AssociateAddress",
        "ec2:DisassociateAddress"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "${var.aws_region}"
        }
      }
    },
    {
      "Sid": "EC2RunInstancesTagging",
      "Effect": "Allow",
      "Action": "ec2:RunInstances",
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringEquals": {
          "aws:RequestTag/ManagedBy": "capsule"
        }
      }
    },
    {
      "Sid": "EC2ScopedActions",
      "Effect": "Allow",
      "Action": [
        "ec2:TerminateInstances",
        "ec2:StartInstances",
        "ec2:StopInstances",
        "ec2:RebootInstances"
      ],
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringEquals": {
          "ec2:ResourceTag/ManagedBy": "capsule"
        }
      }
    },
    {
      "Sid": "VPCManagement",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateVpc",
        "ec2:DeleteVpc",
        "ec2:ModifyVpcAttribute",
        "ec2:CreateSubnet",
        "ec2:DeleteSubnet",
        "ec2:CreateInternetGateway",
        "ec2:DeleteInternetGateway",
        "ec2:AttachInternetGateway",
        "ec2:DetachInternetGateway",
        "ec2:CreateNatGateway",
        "ec2:DeleteNatGateway",
        "ec2:DescribeNatGateways",
        "ec2:CreateRouteTable",
        "ec2:DeleteRouteTable",
        "ec2:CreateRoute",
        "ec2:DeleteRoute",
        "ec2:AssociateRouteTable",
        "ec2:DisassociateRouteTable",
        "ec2:DescribeRouteTables"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "${var.aws_region}"
        }
      }
    },
    {
      "Sid": "ELBManagement",
      "Effect": "Allow",
      "Action": [
        "elasticloadbalancing:CreateLoadBalancer",
        "elasticloadbalancing:DeleteLoadBalancer",
        "elasticloadbalancing:DescribeLoadBalancers",
        "elasticloadbalancing:DescribeLoadBalancerAttributes",
        "elasticloadbalancing:ModifyLoadBalancerAttributes",
        "elasticloadbalancing:CreateTargetGroup",
        "elasticloadbalancing:DeleteTargetGroup",
        "elasticloadbalancing:DescribeTargetGroups",
        "elasticloadbalancing:DescribeTargetHealth",
        "elasticloadbalancing:RegisterTargets",
        "elasticloadbalancing:DeregisterTargets",
        "elasticloadbalancing:CreateListener",
        "elasticloadbalancing:DeleteListener",
        "elasticloadbalancing:DescribeListeners",
        "elasticloadbalancing:ModifyListener",
        "elasticloadbalancing:CreateRule",
        "elasticloadbalancing:DeleteRule",
        "elasticloadbalancing:DescribeRules",
        "elasticloadbalancing:AddTags",
        "elasticloadbalancing:RemoveTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AutoScaling",
      "Effect": "Allow",
      "Action": [
        "autoscaling:CreateAutoScalingGroup",
        "autoscaling:DeleteAutoScalingGroup",
        "autoscaling:UpdateAutoScalingGroup",
        "autoscaling:DescribeAutoScalingGroups",
        "autoscaling:DescribeAutoScalingInstances",
        "autoscaling:CreateLaunchConfiguration",
        "autoscaling:DeleteLaunchConfiguration",
        "autoscaling:DescribeLaunchConfigurations",
        "autoscaling:PutScalingPolicy",
        "autoscaling:DeletePolicy",
        "autoscaling:DescribePolicies",
        "autoscaling:SetDesiredCapacity",
        "autoscaling:TerminateInstanceInAutoScalingGroup",
        "autoscaling:CreateOrUpdateTags"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "autoscaling:ResourceTag/ManagedBy": "capsule"
        }
      }
    },
    {
      "Sid": "Route53Management",
      "Effect": "Allow",
      "Action": [
        "route53:ListHostedZones",
        "route53:ListHostedZonesByName",
        "route53:GetHostedZone",
        "route53:ListResourceRecordSets",
        "route53:ChangeResourceRecordSets",
        "route53:GetChange",
        "route53:TestDNSAnswer"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Route53RecordScoped",
      "Effect": "Allow",
      "Action": "route53:ChangeResourceRecordSets",
      "Resource": "arn:aws:route53:::hostedzone/${var.hosted_zone_id}"
    },
    {
      "Sid": "S3BackupStorage",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketVersioning",
        "s3:PutBucketVersioning",
        "s3:PutBucketEncryption",
        "s3:GetBucketEncryption",
        "s3:PutBucketLifecycleConfiguration",
        "s3:GetBucketLifecycleConfiguration",
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListMultipartUploadParts",
        "s3:AbortMultipartUpload"
      ],
      "Resource": [
        "arn:aws:s3:::capsule-backups-*",
        "arn:aws:s3:::capsule-backups-*/*",
        "arn:aws:s3:::capsule-builds-*",
        "arn:aws:s3:::capsule-builds-*/*"
      ]
    },
    {
      "Sid": "LambdaManagement",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction",
        "lambda:GetFunctionConfiguration",
        "lambda:ListFunctions",
        "lambda:InvokeFunction",
        "lambda:AddPermission",
        "lambda:RemovePermission",
        "lambda:CreateFunctionUrlConfig",
        "lambda:DeleteFunctionUrlConfig",
        "lambda:GetFunctionUrlConfig",
        "lambda:PublishVersion",
        "lambda:CreateAlias",
        "lambda:UpdateAlias",
        "lambda:DeleteAlias",
        "lambda:TagResource",
        "lambda:UntagResource"
      ],
      "Resource": "arn:aws:lambda:*:*:function:capsule-*"
    },
    {
      "Sid": "APIGatewayManagement",
      "Effect": "Allow",
      "Action": [
        "apigateway:GET",
        "apigateway:POST",
        "apigateway:PUT",
        "apigateway:PATCH",
        "apigateway:DELETE"
      ],
      "Resource": "arn:aws:apigateway:*::/apis/capsule-*"
    },
    {
      "Sid": "ACMCertificates",
      "Effect": "Allow",
      "Action": [
        "acm:RequestCertificate",
        "acm:DescribeCertificate",
        "acm:ListCertificates",
        "acm:DeleteCertificate",
        "acm:AddTagsToCertificate",
        "acm:ListTagsForCertificate"
      ],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchMonitoring",
      "Effect": "Allow",
      "Action": [
        "cloudwatch:PutMetricData",
        "cloudwatch:GetMetricData",
        "cloudwatch:GetMetricStatistics",
        "cloudwatch:ListMetrics",
        "cloudwatch:PutMetricAlarm",
        "cloudwatch:DeleteAlarms",
        "cloudwatch:DescribeAlarms",
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:GetLogEvents",
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:FilterLogEvents"
      ],
      "Resource": [
        "arn:aws:logs:*:*:log-group:/capsule/*",
        "arn:aws:logs:*:*:log-group:/capsule/*:*",
        "arn:aws:cloudwatch:*:*:alarm:capsule-*"
      ]
    },
    {
      "Sid": "IAMPassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::*:role/capsule-*",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": [
            "ec2.amazonaws.com",
            "lambda.amazonaws.com",
            "autoscaling.amazonaws.com"
          ]
        }
      }
    },
    {
      "Sid": "IAMInstanceProfile",
      "Effect": "Allow",
      "Action": [
        "iam:GetInstanceProfile",
        "iam:ListInstanceProfiles"
      ],
      "Resource": "arn:aws:iam::*:instance-profile/capsule-*"
    },
    {
      "Sid": "STSGetCallerIdentity",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    },
    {
      "Sid": "SNSNotifications",
      "Effect": "Allow",
      "Action": [
        "sns:CreateTopic",
        "sns:DeleteTopic",
        "sns:Subscribe",
        "sns:Unsubscribe",
        "sns:Publish",
        "sns:ListTopics",
        "sns:ListSubscriptionsByTopic"
      ],
      "Resource": "arn:aws:sns:*:*:capsule-*"
    }
  ]
}
```

---

## 3. Service-by-Service Breakdown

### 3.1 EC2 (Compute)

**Purpose:** Provision and manage servers for running application containers.

| Action | Why |
|---|---|
| `RunInstances` | Launch new EC2 instances for the cluster |
| `TerminateInstances` | Clean up decommissioned nodes |
| `Start/Stop/RebootInstances` | Server lifecycle management |
| `Describe*` | Inventory and status checks |
| `CreateSecurityGroup` | Network security for app containers |
| `CreateTags` | Tag resources with `ManagedBy: capsule` |
| `*Volume` | Persistent storage for databases |
| `*Address` | Elastic IP for stable endpoints |

**Scoping:** Mutating actions are scoped to instances tagged with `ManagedBy: capsule`.

### 3.2 VPC (Networking)

**Purpose:** Create isolated network infrastructure.

| Action | Why |
|---|---|
| `CreateVpc/Subnet` | Isolate Capsule workloads in a dedicated VPC |
| `CreateInternetGateway` | Enable internet access for public subnets |
| `CreateNatGateway` | Outbound internet for private subnets |
| `CreateRouteTable/Route` | Network routing configuration |

**Note:** VPC creation is a one-time operation during initial setup. If you pre-create the VPC, you can remove these permissions.

### 3.3 Elastic Load Balancing

**Purpose:** Distribute traffic across application instances.

| Action | Why |
|---|---|
| `CreateLoadBalancer` | ALB for HTTPS termination and routing |
| `CreateTargetGroup` | Group instances for health-checked routing |
| `RegisterTargets` | Add/remove instances from the load balancer |
| `CreateListener/Rule` | HTTP/HTTPS routing rules |

### 3.4 Auto Scaling

**Purpose:** Automatically scale EC2 capacity based on load.

| Action | Why |
|---|---|
| `CreateAutoScalingGroup` | Define scaling boundaries |
| `PutScalingPolicy` | CPU/memory-based scaling triggers |
| `SetDesiredCapacity` | Manual scaling overrides |

### 3.5 Route 53 (DNS)

**Purpose:** Manage DNS records for custom domains.

| Action | Why |
|---|---|
| `ListHostedZones` | Discover available DNS zones |
| `ChangeResourceRecordSets` | Create/update CNAME, A, TXT records |
| `TestDNSAnswer` | Verify DNS propagation |

**Scoping:** Record changes are scoped to specific hosted zone IDs when possible.

### 3.6 S3 (Storage)

**Purpose:** Store backups, build artifacts, and deployment packages.

| Action | Why |
|---|---|
| `CreateBucket` | Create backup/build storage buckets |
| `PutObject/GetObject` | Upload/download backups and artifacts |
| `PutBucketEncryption` | Enable server-side encryption (SSE-S3) |
| `PutBucketLifecycleConfiguration` | Auto-expire old backups |

**Scoping:** Restricted to buckets matching `capsule-backups-*` and `capsule-builds-*`.

### 3.7 Lambda (Serverless)

**Purpose:** Deploy serverless functions for projects with `--serverless` flag.

| Action | Why |
|---|---|
| `CreateFunction` | Deploy serverless application code |
| `UpdateFunctionCode` | Update function on new deployments |
| `InvokeFunction` | Health checks and testing |
| `CreateFunctionUrlConfig` | Public HTTPS endpoint for the function |

**Scoping:** Restricted to functions matching `capsule-*`.

### 3.8 ACM (Certificates)

**Purpose:** Manage SSL/TLS certificates for ALB HTTPS listeners.

| Action | Why |
|---|---|
| `RequestCertificate` | Provision SSL certificates for custom domains |
| `DescribeCertificate` | Check certificate validation status |
| `DeleteCertificate` | Clean up unused certificates |

### 3.9 CloudWatch (Monitoring)

**Purpose:** Centralized logging and monitoring.

| Action | Why |
|---|---|
| `PutMetricData` | Push custom application metrics |
| `PutMetricAlarm` | Create CPU/memory alerts |
| `CreateLogGroup/Stream` | Organize application logs |
| `PutLogEvents` | Send container logs to CloudWatch |

**Scoping:** Log groups restricted to `/capsule/*` prefix.

### 3.10 IAM (Roles)

**Purpose:** Pass roles to EC2 instances and Lambda functions.

| Action | Why |
|---|---|
| `PassRole` | Assign instance profiles to new EC2 instances |
| `GetInstanceProfile` | Verify instance profile exists |

**Scoping:** Only `capsule-*` prefixed roles, only passable to specific services.

---

## 4. Security Best Practices

### 4.1 Use Instance Profiles, Not API Keys

```
Recommended:   EC2 Instance Profile → IAM Role → Policy
Avoid:         IAM User → Access Key + Secret Key
```

Instance profiles automatically rotate credentials and eliminate static key management.

### 4.2 Tag-Based Access Control

All Capsule-managed resources are tagged:

```json
{
  "ManagedBy": "capsule",
  "CapsuleProject": "<project-slug>",
  "CapsuleEnvironment": "production"
}
```

IAM conditions use these tags to scope access:

```json
{
  "Condition": {
    "StringEquals": {
      "ec2:ResourceTag/ManagedBy": "capsule"
    }
  }
}
```

### 4.3 Region Restriction

Lock Capsule to a specific AWS region:

```json
{
  "Condition": {
    "StringEquals": {
      "aws:RequestedRegion": "us-east-1"
    }
  }
}
```

### 4.4 MFA Enforcement

For IAM users (dev/testing), require MFA:

```json
{
  "Sid": "DenyWithoutMFA",
  "Effect": "Deny",
  "NotAction": [
    "iam:CreateVirtualMFADevice",
    "iam:EnableMFADevice",
    "iam:GetUser",
    "iam:ListMFADevices",
    "sts:GetSessionToken"
  ],
  "Resource": "*",
  "Condition": {
    "BoolIfExists": {
      "aws:MultiFactorAuthPresent": "false"
    }
  }
}
```

### 4.5 Service Control Policies (SCP)

If using AWS Organizations, apply SCPs to prevent:
- Disabling CloudTrail
- Deleting S3 bucket encryption
- Creating resources outside allowed regions
- Modifying IAM policies

### 4.6 Key Rotation

| Credential | Rotation Frequency | Method |
|---|---|---|
| IAM access keys | 90 days | AWS CLI: `aws iam create-access-key` |
| Instance profile | Automatic | Managed by AWS (every ~6h) |
| Encryption master key | 365 days | KMS automatic rotation |

---

## 5. Deployment Scenario Policies

### 5.1 Minimal Single-Server (No Auto-Scaling)

For a single EC2 instance running everything:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MinimalEC2",
      "Effect": "Allow",
      "Action": [
        "ec2:DescribeInstances",
        "ec2:DescribeSecurityGroups",
        "ec2:DescribeSubnets",
        "ec2:DescribeVpcs",
        "ec2:CreateTags"
      ],
      "Resource": "*"
    },
    {
      "Sid": "Route53Minimal",
      "Effect": "Allow",
      "Action": [
        "route53:ListHostedZones",
        "route53:ChangeResourceRecordSets",
        "route53:GetChange"
      ],
      "Resource": "*"
    },
    {
      "Sid": "S3Backups",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::capsule-backups-*",
        "arn:aws:s3:::capsule-backups-*/*"
      ]
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/capsule/*"
    }
  ]
}
```

### 5.2 Multi-Server with Auto-Scaling

Use the [full policy from Section 2](#2-minimum-required-policy).

### 5.3 Serverless-Only

For projects that only use Lambda:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaFull",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction",
        "lambda:DeleteFunction",
        "lambda:UpdateFunctionCode",
        "lambda:UpdateFunctionConfiguration",
        "lambda:GetFunction",
        "lambda:ListFunctions",
        "lambda:InvokeFunction",
        "lambda:CreateFunctionUrlConfig",
        "lambda:DeleteFunctionUrlConfig",
        "lambda:TagResource"
      ],
      "Resource": "arn:aws:lambda:*:*:function:capsule-*"
    },
    {
      "Sid": "S3ForLambdaCode",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::capsule-builds-*",
        "arn:aws:s3:::capsule-builds-*/*"
      ]
    },
    {
      "Sid": "IAMPassRoleToLambda",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::*:role/capsule-lambda-execution",
      "Condition": {
        "StringEquals": {
          "iam:PassedToService": "lambda.amazonaws.com"
        }
      }
    },
    {
      "Sid": "CloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:GetLogEvents"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/lambda/capsule-*"
    }
  ]
}
```

---

## 6. Cross-Account Access

For organizations using separate AWS accounts for staging and production.

### 6.1 Trust Policy (Target Account)

In the production account, create a role `capsule-cross-account`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowCrossAccountAssume",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::111111111111:role/capsule-platform"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "capsule-org-abc123"
        }
      }
    }
  ]
}
```

### 6.2 Assume Role Permission (Source Account)

In the Capsule management account:

```json
{
  "Sid": "AssumeProductionRole",
  "Effect": "Allow",
  "Action": "sts:AssumeRole",
  "Resource": "arn:aws:iam::222222222222:role/capsule-cross-account"
}
```

### 6.3 Capsule Configuration

```json
{
  "aws": {
    "accounts": {
      "staging": {
        "region": "us-east-1",
        "role_arn": "arn:aws:iam::111111111111:role/capsule-platform"
      },
      "production": {
        "region": "us-east-1",
        "role_arn": "arn:aws:iam::222222222222:role/capsule-cross-account",
        "external_id": "capsule-org-abc123"
      }
    }
  }
}
```

---

## 7. Instance Profile Setup

### Step 1: Create the IAM Role

```bash
aws iam create-role \
  --role-name capsule-platform \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {"Service": "ec2.amazonaws.com"},
      "Action": "sts:AssumeRole"
    }]
  }'
```

### Step 2: Attach the Policy

```bash
# Save the policy from Section 2 as capsule-policy.json
aws iam create-policy \
  --policy-name CapsulePlatformPolicy \
  --policy-document file://capsule-policy.json

aws iam attach-role-policy \
  --role-name capsule-platform \
  --policy-arn arn:aws:iam::123456789012:policy/CapsulePlatformPolicy
```

### Step 3: Create Instance Profile

```bash
aws iam create-instance-profile \
  --instance-profile-name capsule-platform

aws iam add-role-to-instance-profile \
  --instance-profile-name capsule-platform \
  --role-name capsule-platform
```

### Step 4: Launch EC2 with Instance Profile

```bash
aws ec2 run-instances \
  --image-id ami-0abcdef1234567890 \
  --instance-type t3.medium \
  --iam-instance-profile Name=capsule-platform \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=capsule-primary},{Key=ManagedBy,Value=capsule}]' \
  --key-name my-ssh-key \
  --security-group-ids sg-0123456789abcdef0
```

---

## 8. Policy Validation

### Validate with IAM Access Analyzer

```bash
aws accessanalyzer validate-policy \
  --policy-document file://capsule-policy.json \
  --policy-type IDENTITY_POLICY
```

### Simulate Policy

```bash
aws iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::123456789012:role/capsule-platform \
  --action-names ec2:RunInstances s3:PutObject route53:ChangeResourceRecordSets \
  --resource-arns arn:aws:ec2:us-east-1:123456789012:instance/*
```

### CloudTrail Audit

Monitor all API calls made by Capsule:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=Username,AttributeValue=capsule-platform \
  --start-time 2026-05-25T00:00:00Z \
  --end-time 2026-05-26T23:59:59Z
```

### Permission Boundary

Apply a permission boundary to prevent privilege escalation:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowedServices",
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "elasticloadbalancing:*",
        "autoscaling:*",
        "route53:*",
        "s3:*",
        "lambda:*",
        "acm:*",
        "cloudwatch:*",
        "logs:*",
        "sns:*",
        "apigateway:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DenyIAMEscalation",
      "Effect": "Deny",
      "Action": [
        "iam:CreateUser",
        "iam:CreateRole",
        "iam:AttachRolePolicy",
        "iam:PutRolePolicy",
        "iam:CreatePolicy",
        "iam:DeletePolicy",
        "iam:AttachUserPolicy",
        "iam:PutUserPolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

Apply it:

```bash
aws iam put-role-permissions-boundary \
  --role-name capsule-platform \
  --permissions-boundary arn:aws:iam::123456789012:policy/CapsulePermissionBoundary
```

---

> **Resumen (ES):** Documentación completa de las políticas IAM de AWS necesarias para Capsule. Incluye la política mínima requerida con permisos de mínimo privilegio, desglose por servicio (EC2, VPC, ELB, Auto Scaling, Route 53, S3, Lambda, ACM, CloudWatch, IAM), mejores prácticas de seguridad (instance profiles, control por tags, restricción de región, MFA), políticas para diferentes escenarios de despliegue (servidor único, multi-servidor, solo serverless), acceso cross-account con role assumption, configuración de instance profiles paso a paso, y validación de políticas con Access Analyzer y CloudTrail.
