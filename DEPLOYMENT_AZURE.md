# ☁️ Azure Production Deployment Guide

This guide shows how to deploy **Prama E2EE** to Azure while keeping all real credentials hidden. Replace placeholder values (`<PLACEHOLDER>`) with your own secure secrets.

---

## 1️⃣ Database & Message Broker

- **Database**: Provision an **Azure Database for PostgreSQL – Flexible Server**.
  - Create the server, set a strong admin password, and enable SSL connections.
  - In `Backend/src/main/resources/application.properties` set the connection string:
    ```properties
    spring.datasource.url=jdbc:postgresql://<POSTGRES_HOST>:5432/<POSTGRES_DB>?sslmode=require
    spring.datasource.username=<POSTGRES_USER>
    spring.datasource.password=<POSTGRES_PASSWORD>
    ```
- **Message Broker**: Deploy RabbitMQ (e.g., Docker on an Azure VM or a managed container instance).
  - After RabbitMQ is up, enable STOMP support:
    ```bash
    rabbitmq-plugins enable rabbitmq_stomp
    ```
  - Open port **61613** on the VM/network security group.
  - Add the connection details to `Backend/.env` (or `.env.example` for placeholders):
    ```text
    RABBITMQ_HOST=<RABBITMQ_HOST>
    RABBITMQ_USERNAME=<RABBITMQ_USER>
    RABBITMQ_PASSWORD=<RABBITMQ_PASSWORD>
    RABBITMQ_VIRTUAL_HOST=<RABBITMQ_VHOST>
    ```

---

## 2️⃣ Backend (Spring Boot)

1. **Package the JAR** (already done by CI):
   ```bash
   cd Backend
   ./mvnw clean package -DskipTests
   ```
   The resulting JAR will be located at `Backend/target/prama-0.0.1-SNAPSHOT.jar`.
2. **Deploy to Azure App Service (Linux – Java 17)**:
   - Create an **App Service** with the **Java 17** runtime.
   - In the **Deployment Center**, choose **GitHub** (or local Git) and point to your repository.
   - Upload the JAR via the **Console** or **FTP**:
     ```bash
     az webapp deploy --resource-group <RG> --name <APP_NAME> --src-path Backend/target/prama-0.0.1-SNAPSHOT.jar
     ```
3. **Critical Web‑Socket Configuration**:
   - In the Azure Portal, go to **Configuration → General Settings** and toggle **WebSockets** **ON**.
   - Ensure **HTTPS Only** is enabled (Azure will handle SSL certificates automatically).
4. **Environment Variables** (App Service Settings):
   - Add all variables from your `.env` (but with placeholder values) under **Configuration → Application settings**.
   - Example entries:
     ```text
     DB_URL=jdbc:postgresql://<POSTGRES_HOST>:5432/<POSTGRES_DB>?sslmode=require
     DB_USERNAME=<POSTGRES_USER>
     DB_PASSWORD=<POSTGRES_PASSWORD>
     JWT_SECRET_KEY=<YOUR_JWT_SECRET>
     RABBITMQ_HOST=<RABBITMQ_HOST>
     RABBITMQ_USERNAME=<RABBITMQ_USER>
     RABBITMQ_PASSWORD=<RABBITMQ_PASSWORD>
     RABBITMQ_VIRTUAL_HOST=<RABBITMQ_VHOST>
     ```

---

## 3️⃣ Frontend (React)

1. **Build the static files** (already done):
   ```bash
   cd FrontendWeb
   npm run build
   ```
   The output appears in `FrontendWeb/dist/`.
2. **Deploy to Azure Static Web Apps** (or any static‑host provider):
   - In Azure Portal, create a **Static Web App** and connect the GitHub repo.
   - Set the **App artifact location** to `FrontendWeb/dist`.
   - Alternatively, use the Azure CLI:
     ```bash
     az staticwebapp create \
       --name <STATIC_APP_NAME> \
       --resource-group <RG> \
       --location <REGION> \
       --source . \
       --location "FrontendWeb/dist"
     ```
3. **Environment Variables** (frontend):
   - In the **Static Web App** configuration, add a **Application setting** called `REACT_APP_API_URL` pointing to the backend URL (e.g., `https://<APP_NAME>.azurewebsites.net/api`).
   - For secure WebSocket connections, set:
     ```text
     REACT_APP_WEBSOCKET_URL=wss://<APP_NAME>.azurewebsites.net/ws
     ```
   - **Never** commit real secrets. Use the placeholder values above and store the actual secrets in Azure **Key Vault** or the **App Service/Static Web App** settings.

---

## 🔐 Security Recommendations

- **Never** store real credentials in the repository. Use placeholders in the repo and inject secrets through Azure’s managed configuration or Azure Key Vault.
- Enable **Managed Identity** for the App Service and grant it read access to the Key Vault where the real secrets reside.
- Rotate database passwords and RabbitMQ credentials regularly.
- Set **CORS** on the backend to only allow your Azure Static Web App domain.
- Use **HTTPS** everywhere (Azure enforces it for App Services and Static Web Apps).

---

## 📦 CI/CD (Optional)

You can automate the whole pipeline with GitHub Actions:
```yaml
name: Azure Deploy
on:
  push:
    branches: [ main ]
jobs:
  build-backend:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up JDK 17
        uses: actions/setup-java@v3
        with:
          java-version: '17'
          distribution: 'temurin'
      - name: Build JAR
        run: |
          cd Backend
          ./mvnw clean package -DskipTests
      - name: Deploy Backend to Azure
        uses: azure/webapps-deploy@v2
        with:
          app-name: <APP_NAME>
          slot-name: production
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: Backend/target/prama-0.0.1-SNAPSHOT.jar
  build-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      - name: Build Frontend
        run: |
          cd FrontendWeb
          npm ci
          npm run build
      - name: Deploy Frontend to Azure Static Web Apps
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/FrontendWeb"
          output_location: "dist"
```
Replace `<APP_NAME>` and other placeholders with your Azure resource names.

---

**That’s it!** Follow the steps, inject your real secrets only via Azure configuration, and you’ll have a fully production‑ready Prama E2EE deployment on Azure.
