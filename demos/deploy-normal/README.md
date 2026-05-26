# Capsule Demo — Normal ECS Container Deployment

This demo shows how to deploy a standard containerized web application on AWS ECS using Capsule CLI.

## How to Deploy

1. Initialize and configure the Capsule CLI URL and login to your self-hosted instance:
   ```bash
   capsule login --email your-email@domain.com --password yourpassword
   ```

2. Create a new project inside your active organization:
   ```bash
   capsule projects create --name "My Normal ECS App" --slug "my-ecs-app" --runtime "go"
   ```

3. Configure horizontal scale settings if necessary:
   ```bash
   capsule scale my-ecs-app --replicas 2 --min 1 --max 5 --cpu-threshold 75
   ```

4. Trigger a deployment by passing the Git SHA (or let Capsule pull from your repo):
   ```bash
   capsule deploy --project [project-uuid] --sha "a1b2c3d4"
   ```
