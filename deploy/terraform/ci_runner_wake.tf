# CI runner scale-to-zero, on-demand start. The runner stops itself when idle
# (deploy/forgejo/runner-idle-stop); the Capsule API starts it on push/PR
# (backend/internal/ciwake). EVERYTHING here is count = 0 unless var.ci_runner_enabled = true.
#
# Least privilege: describe + start on THIS instance only. ec2:DescribeInstances does not support
# resource-level permissions in IAM, so it is "*" (read-only); StartInstances is pinned to the ARN.
# A separate policy: the existing capsule_api policies are not touched.

data "aws_iam_policy_document" "ci_runner_wake" {
  count = local.ci_runner_count

  statement {
    sid       = "DescribeInstances"
    actions   = ["ec2:DescribeInstances"]
    resources = ["*"]
  }

  statement {
    sid       = "StartCiRunnerOnly"
    actions   = ["ec2:StartInstances"]
    resources = ["arn:aws:ec2:${var.aws_region}:${var.aws_account_id}:instance/${aws_instance.ci_runner[0].id}"]
  }
}

resource "aws_iam_user_policy" "capsule_api_ci_runner_wake" {
  count  = local.ci_runner_count
  name   = "${var.app_name}-api-ci-runner-wake"
  user   = aws_iam_user.capsule_api.name
  policy = data.aws_iam_policy_document.ci_runner_wake[0].json
}

output "ci_runner_wake_instance_id" {
  description = "Value for CAPSULE_CI_RUNNER_INSTANCE_ID in the backend environment (null when the runner is disabled)."
  value       = try(aws_instance.ci_runner[0].id, null)
}
