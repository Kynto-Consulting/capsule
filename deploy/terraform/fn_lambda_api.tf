# Runtime `lambda` of VPN functions (`capsule fn deploy --runtime lambda`, backend/internal/fn/lambdaexec.go): the backend user
# capsule-api creates, updates, invokes and deletes one Lambda per function, named `capsule-fn-<12 hex>`. The project Lambdas
# (`capsule-<12 hex>`) were already covered by capsule-api-policy; the function ones were not (first real build, 06-nov-2026:
# AccessDeniedException on lambda:GetFunction for capsule-fn-948599dec066).
#
# Least privilege: only the six calls LambdaExecutor makes (plus TagResource/ListTags: CreateFunction sends Tags), only on capsule-fn-*, and PassRole only for capsule-lambda-role to
# Lambda. The image pull (ecr:BatchGetImage / GetDownloadUrlForLayer) is what CreateFunction/UpdateFunctionCode check on the caller,
# only on the capsule/fn-* repositories the build creates. A separate managed policy: the existing ones are not touched (the
# user's inline quota is full; see ci_runner_wake.tf).

data "aws_iam_policy_document" "capsule_api_fn_lambda" {
  statement {
    sid = "FunctionLambdas"
    actions = [
      "lambda:CreateFunction",
      "lambda:GetFunction",
      "lambda:UpdateFunctionCode",
      "lambda:UpdateFunctionConfiguration",
      "lambda:InvokeFunction",
      "lambda:DeleteFunction",
      # CreateFunction lleva Tags (capsule-fn, capsule-project): AWS lo autoriza como TagResource aparte.
      "lambda:TagResource",
      "lambda:ListTags",
    ]
    resources = ["arn:aws:lambda:${var.aws_region}:${var.aws_account_id}:function:capsule-fn-*"]
  }

  statement {
    sid       = "PassLambdaRole"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.lambda_execution.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  statement {
    sid       = "FunctionImages"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:GetRepositoryPolicy", "ecr:SetRepositoryPolicy"]
    resources = ["arn:aws:ecr:${var.aws_region}:${var.aws_account_id}:repository/capsule/fn-*"]
  }
}

resource "aws_iam_policy" "capsule_api_fn_lambda" {
  name   = "${var.app_name}-api-fn-lambda"
  policy = data.aws_iam_policy_document.capsule_api_fn_lambda.json
}

resource "aws_iam_user_policy_attachment" "capsule_api_fn_lambda" {
  user       = aws_iam_user.capsule_api.name
  policy_arn = aws_iam_policy.capsule_api_fn_lambda.arn
}
