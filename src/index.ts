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
    subPrompts?: string[]; // Referans verilen diğer prompt ID'leri
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

function savePrompts(prompts: Prompt[]): void {
    try {
        const promptsPath = path.join(process.cwd(), "prompts.json");
        fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2), "utf-8");
    } catch (error) {
        console.error("Prompts kaydetme hatası:", error);
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
                },
                {
                    name: "add_prompt",
                    description: "Yeni bir prompt veya prompt seti ekler",
                    inputSchema: {
                        type: "object",
                        properties: {
                            title: { type: "string", description: "Prompt başlığı" },
                            content: { type: "string", description: "Prompt içeriği" },
                            tags: { type: "array", items: { type: "string" }, description: "Etiketler" },
                            subPrompts: { type: "array", items: { type: "string" }, description: "Alt prompt ID'leri" }
                        },
                        required: ["title", "content"]
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

            // Alt promptları getir (varsa)
            let result: any = { ...prompt };
            if (prompt.subPrompts && prompt.subPrompts.length > 0) {
                result.resolvedSubPrompts = prompt.subPrompts.map(subId => {
                    const subPrompt = prompts.find(p => p.id === subId);
                    return subPrompt || { id: subId, error: "Alt prompt bulunamadı" };
                });
            }

            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        if (name === "add_prompt") {
            const { title, content, tags, subPrompts } = (args as any) || {};
            if (!title || !content) {
                return { content: [{ type: "text", text: "Başlık ve içerik zorunludur" }], isError: true };
            }

            const newPrompt: Prompt = {
                id: (prompts.length > 0 ? (Math.max(...prompts.map(p => parseInt(p.id))) + 1).toString() : "1"),
                title,
                content,
                tags: tags || [],
                subPrompts: subPrompts || []
            };

            const updatedPrompts = [...prompts, newPrompt];
            savePrompts(updatedPrompts);

            return {
                content: [{
                    type: "text",
                    text: `Prompt başarıyla eklendi. ID: ${newPrompt.id}`
                }]
            };
        }

        throw new Error(`Bilinmeyen araç: ${name}`);
    });

    // Bağlantıyı Başlat
    try {
        await server.connect(transport);
        console.log(`[${new Date().toISOString()}] Oturum bağlandı: ${sessionId}`);

        // Heartbeat (Render/SSE canlı tutma)
        const heartbeatInterval = setInterval(() => {
            res.write(': keep-alive\n\n');
        }, 45000); // 45 saniyede bir

        res.on("close", () => {
            clearInterval(heartbeatInterval);
            transports.delete(sessionId);
            console.log(`[${new Date().toISOString()}] Oturum kapandı: ${sessionId}`);
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Bağlantı hatası (${sessionId}):`, error);
        res.end();
    }
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
