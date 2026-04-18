export default {
  async fetch(request, env, ctx) {
    return new Response(JSON.stringify({
      status: "online",
      message: "VelisMail Backend Worker Entrypoint"
    }), {
      headers: {
        "content-type": "application/json;charset=UTF-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
    });
  }
};
