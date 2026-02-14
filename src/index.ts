import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

// --- Veri Katmanı ---
interface Prompt {
    id: string;
    title: string;
    content: string;
    tags: string[];
}

function loadPrompts(): Prompt[] {
    try {
        const promptsPath = path.join(process.cwd(), "prompts.json");
        if (!fs.existsSync(promptsPath)) return [];
        return JSON.parse(fs.readFileSync(promptsPath, "utf-8"));
    } catch (error) {
        console.error("Prompts yükleme hatası:", error);
        return [];
    }
}

// --- Sunucu Katmanı ---
const app = express();
app.use(cors());

// Bellekteki aktif transportlar
const transports = new Map<string, SSEServerTransport>();

// Ana sayfa (Health Check)
app.get("/", (req, res) => {
    res.json({
        status: "ok",
        message: "Prompt Archive MCP Server is alive",
        timestamp: new Date().toISOString(),
        version: "1.0.1"
    });
});

// SSE Bağlantı Noktası
app.get("/sse", async (req, res) => {
    console.log(`[${new Date().toISOString()}] Yeni SSE bağlantı isteği...`);

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    // Her bağlantı için YENİ bir Server instance'ı (Protocol izolasyonu)
    const server = new Server(
        { name: "prompt-archive-server", version: "1.0.1" },
        { capabilities: { tools: {} } }
    );

    // Araçları Tanımla (Low-level API)
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const prompts = loadPrompts();
        return {
            tools: [
                {
                    name: "list_prompts",
                    description: "Mevcut tüm promptları listeler",
                    inputSchema: { type: "object", properties: {} }
                },
                {
                    name: "get_prompt",
                    description: "ID ile detaylı prompt içeriğini getirir",
                    inputSchema: {
                        type: "object",
                        properties: { id: { type: "string" } },
                        required: ["id"]
                    }
                }
            ]
        };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const prompts = loadPrompts();
        const { name, arguments: args } = request.params;

        if (name === "list_prompts") {
            return {
                content: [{
                    type: "text",
                    text: JSON.stringify(prompts.map(p => ({ id: p.id, title: p.title, tags: p.tags })), null, 2)
                }]
            };
        }

        if (name === "get_prompt") {
            const id = (args as any)?.id;
            const prompt = prompts.find(p => p.id === id);
            if (!prompt) return { content: [{ type: "text", text: "Prompt bulunamadı" }], isError: true };
            return { content: [{ type: "text", text: JSON.stringify(prompt, null, 2) }] };
        }

        throw new Error(`Bilinmeyen araç: ${name}`);
    });

    // Bağlantıyı Başlat
    try {
        await server.connect(transport);
        console.log(`[${new Date().toISOString()}] Oturum bağlandı: ${sessionId}`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Bağlantı hatası (${sessionId}):`, error);
    }

    res.on("close", () => {
        transports.delete(sessionId);
        console.log(`[${new Date().toISOString()}] Oturum kapandı: ${sessionId}`);
    });
});

// Mesaj İşleme Noktası
app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);

    if (!transport) {
        res.status(404).send("Geçersiz oturum");
        return;
    }

    try {
        await transport.handlePostMessage(req, res);
    } catch (error) {
        console.error("Mesaj işleme hatası:", error);
        res.status(500).send("Dahili hata");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] Sunucu port ${PORT} üzerinde hazır`);
});
