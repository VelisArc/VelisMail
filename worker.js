// VelisMail Cloudflare Worker Entrypoint
// Acts as an API Gateway proxying requests to the backend Rust microservices

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
};

export default {
  async fetch(request, env, ctx) {
    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: CORS_HEADERS,
      });
    }

    const url = new URL(request.url);

    // Provide a health check endpoint for the worker itself
    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response(JSON.stringify({
        status: "online",
        message: "VelisMail Cloudflare Worker API Gateway",
        timestamp: new Date().toISOString()
      }), {
        headers: {
          "content-type": "application/json;charset=UTF-8",
          ...CORS_HEADERS
        }
      });
    }

    // Proxy requests to the backend API
    // Ensure you have an environment variable BACKEND_API_URL set to your Rust api-gateway URL
    // e.g., BACKEND_API_URL = "https://api.velismail.online"
    const backendUrl = env.BACKEND_API_URL || "http://localhost:3000";

    try {
      const targetUrl = new URL(url.pathname + url.search, backendUrl);

      // Forward the request to the backend
      const response = await fetch(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined,
        redirect: "manual",
      });

      // Construct the response to send back to the client
      const responseHeaders = new Headers(response.headers);

      // Ensure CORS headers are present on the response
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        responseHeaders.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (error) {
      return new Response(JSON.stringify({
        error: "Gateway Error",
        message: "Failed to connect to the backend services.",
        details: error.message
      }), {
        status: 502,
        headers: {
          "content-type": "application/json;charset=UTF-8",
          ...CORS_HEADERS
        }
      });
    }
  }
};
