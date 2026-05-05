# React + Vite + Hono + Cloudflare Workers

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/templates/tree/main/vite-react-template)

This template provides a minimal setup for building a React application with TypeScript and Vite, designed to run on Cloudflare Workers. It features hot module replacement, ESLint integration, and the flexibility of Workers deployments.

![React + TypeScript + Vite + Cloudflare Workers](https://imagedelivery.net/wSMYJvS3Xw-n339CbDyDIA/fc7b4b62-442b-4769-641b-ad4422d74300/public)

<!-- dash-content-start -->

🚀 Supercharge your web development with this powerful stack:

- [**React**](https://react.dev/) - A modern UI library for building interactive interfaces
- [**Vite**](https://vite.dev/) - Lightning-fast build tooling and development server
- [**Hono**](https://hono.dev/) - Ultralight, modern backend framework
- [**Cloudflare Workers**](https://developers.cloudflare.com/workers/) - Edge computing platform for global deployment

### ✨ Key Features

- 🔥 Hot Module Replacement (HMR) for rapid development
- 📦 TypeScript support out of the box
- 🛠️ ESLint configuration included
- ⚡ Zero-config deployment to Cloudflare's global network
- 🎯 API routes with Hono's elegant routing
- 🔄 Full-stack development setup
- 🔎 Built-in Observability to monitor your Worker

Get started in minutes with local development or deploy directly via the Cloudflare dashboard. Perfect for building modern, performant web applications at the edge.

<!-- dash-content-end -->

## Getting Started

To start a new project with this template, run:

```bash
npm create cloudflare@latest -- --template=cloudflare/templates/vite-react-template
```

A live deployment of this template is available at:
[https://react-vite-template.templates.workers.dev](https://react-vite-template.templates.workers.dev)

## Development

Install dependencies:

```bash
npm install
```

Start the development server with:

```bash
npm run dev
```

Your application will be available at [http://localhost:5173](http://localhost:5173).

## Reverse Proxy (80/443)

For production, publish the app behind a reverse proxy on ports 80/443.

- Port 80: redirect all traffic to HTTPS
- Port 443: terminate TLS and proxy to app upstream
- Example Nginx config: `deploy/nginx-reverse-proxy.conf`

This setup ensures remote devices can use a stable HTTPS endpoint.

## Ping UI and POST API

The app shows ping results sent by remote devices:

- Remote device sends ping result with HTTP POST
- Web UI periodically fetches latest results
- Results are listed as text history (latest first)

The frontend reads data from the GET endpoint below.

### Ingest Token (Zorunlu)

Veri alan POST endpointleri token ile korunur:

- `POST /api/ping-results`
- `POST /api/messages`

Worker secret ayarı:

```bash
wrangler secret put API_INGEST_TOKEN
```

İsteklerde aşağıdaki başlıklardan birini gönderin:

- `Authorization: Bearer <token>`
- `X-API-Token: <token>`

### Device -> Server Endpoint

- Method: POST
- Path: /api/ping-results
- Content-Type: application/json

Request body:

```json
{
  "deviceName": "Kamera-01",
  "deviceAddress": "192.168.1.20",
  "status": "up",
  "latencyMs": 21,
  "checkedAt": "2026-05-01T09:40:00.000Z",
  "message": "Cihaz yanıt verdi"
}
```

Sample response:

```json
{
  "ok": true,
  "stored": {
    "deviceName": "Kamera-01",
    "deviceAddress": "192.168.1.20",
    "status": "up",
    "latencyMs": 21,
    "checkedAt": "2026-05-01T09:40:00.000Z",
    "message": "Cihaz yanıt verdi"
  }
}
```

Example POST from remote device (recommended over 443):

```bash
curl -X POST https://your-domain.example/api/ping-results \
	-H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
	-d '{"deviceName":"Kamera-01","deviceAddress":"192.168.1.20","status":"up","latencyMs":21,"message":"Cihaz yanıt verdi"}'
```

Recommended device URL:

```text
https://your-domain.example/api/ping-results
```

### Web UI -> Server Endpoint

- Method: GET
- Path: /api/ping-results

Sample response:

```json
{
  "items": [
    {
      "deviceName": "Kamera-01",
      "deviceAddress": "192.168.1.20",
      "status": "up",
      "latencyMs": 21,
      "checkedAt": "2026-05-01T09:40:00.000Z",
      "message": "Cihaz yanıt verdi"
    }
  ]
}
```

## Production

Build your project for production:

```bash
npm run build
```

Preview your build locally:

```bash
npm run preview
```

Deploy your project to Cloudflare Workers:

```bash
npm run build && npm run deploy
```

Monitor your workers:

```bash
npx wrangler tail
```

## Additional Resources

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Vite Documentation](https://vitejs.dev/guide/)
- [React Documentation](https://reactjs.org/)
- [Hono Documentation](https://hono.dev/)
