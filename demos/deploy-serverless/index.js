// Simple AWS Lambda Zip handler function
exports.handler = async (event) => {
    console.log("Capsule Serverless invocation event received:", JSON.stringify(event, null, 2));

    const response = {
        statusCode: 200,
        headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
            message: "🚀 Welcome to Capsule Serverless Deployment!",
            description: "Your AWS Lambda handler function executed perfectly.",
            timestamp: new Date().toISOString(),
            context: {
                functionName: process.env.AWS_LAMBDA_FUNCTION_NAME || "local-test-fn",
                memoryLimitInMB: process.env.AWS_LAMBDA_FUNCTION_MEMORY_LIMIT_IN_MB || "128"
            }
        })
    };

    return response;
};
