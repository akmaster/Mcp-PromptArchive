import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

/**
 * Bu script, yerel MCP istemcisi (Antigravity/Claude) ile 
 * uzak Render sunucusu arasında bir köprü (bridge) görevi görür.
 * 
 * Yerel: Stdio üzerinden haberleşir.
 * Uzak: SSE (Server-Sent Events) üzerinden haberleşir.
 */

async function main() {
    const remoteUrl = new URL("https://mcp-promptarchive.onrender.com/sse");

    // 1. Uzak sunucuya SSE üzerinden bağlan
    const sseTransport = new SSEClientTransport(remoteUrl);

    // 2. Yerel istemciye Stdio üzerinden bağlan (Bridge olarak davran)
    // Not: Burada StdioServerTransport kullanarak Antigravity'ye bir "sunucu" gibi görünüyoruz
    // ama aslında gelen her mesajı uzak sunucuya iletiyoruz.
    const stdioTransport = new StdioServerTransport();

    // SSE -> Stdio (Uzakta cevap gelince yerel istemciye ilet)
    sseTransport.onmessage = (message) => {
        stdioTransport.send(message).catch(err => console.error("Stdio send error:", err));
    };

    // Stdio -> SSE (Yerelden istek gelince uzak sunucuya ilet)
    stdioTransport.onmessage = (message) => {
        sseTransport.send(message).catch(err => console.error("SSE send error:", err));
    };

    // Hata yönetimi
    sseTransport.onerror = (error) => {
        console.error("SSE Transport Error:", error);
        process.exit(1);
    };

    stdioTransport.onerror = (error) => {
        console.error("Stdio Transport Error:", error);
        process.exit(1);
    };

    // Bağlantıları başlat
    try {
        await sseTransport.start();
        await stdioTransport.start();
        // Bridge hazır
    } catch (error) {
        console.error("Failed to start bridge:", error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error("Bridge fatal error:", error);
    process.exit(1);
});
