// config.js — used by the MCP server (index.js)
// The web app (server.js) receives the API key per-request from the UI instead.
export function loadConfig() {
  const apiKey = process.env.KLAVIYO_API_KEY || process.env.API_KEY;
  if (!apiKey) throw new Error('Set KLAVIYO_API_KEY env var to use the MCP server (npm run mcp)');
  return { klaviyo_api_key: apiKey };
}
