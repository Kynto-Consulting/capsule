# Capsule Demo — AWS Lambda Serverless Deployment

This demo shows how to deploy a serverless function directly to AWS Lambda using the Capsule platform.

## How to Deploy

1. Zip your handler file:
   ```bash
   # On macOS / Linux
   zip function.zip index.js
   
   # On Windows
   Compress-Archive -Path index.js -DestinationPath function.zip
   ```

2. Authenticate with Capsule CLI:
   ```bash
   capsule login --email your-email@domain.com --password yourpassword
   ```

3. Create a project marked with serverless enabled:
   - Dashboard: Toggle "Serverless Deploy" when creating the project.
   - CLI:
     ```bash
     capsule projects create --name "My Lambda Function" --slug "my-lambda-app" --runtime "node"
     ```

4. Trigger deployment passing the deployment flag:
   ```bash
   capsule deploy --project [project-uuid] --sha "serverless"
   ```
