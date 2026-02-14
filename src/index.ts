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
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Veri Katmanı ---
interface Prompt {
    id: string;
    title: string;
    content?: string;
    tags: string[];
    subPrompts?: string[]; // Referans verilen diğer prompt ID'leri
    filePath?: string;
}

// Veri dosyası konumu: Çalıştırılan komutun dizininden bağımsız olarak, 
// projenin kök dizinindeki (src veya dist'in bir üstü) prompts.json'ı hedefler.
const PROMPTS_PATH = process.env.PROMPTS_PATH || path.join(__dirname, "..", "prompts.json");

function loadPrompts(): Prompt[] {
    try {
        if (!fs.existsSync(PROMPTS_PATH)) {
            console.log(`[${new Date().toISOString()}] prompts.json bulunamadı: ${PROMPTS_PATH}`);
            return [];
        }
        return JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf-8"));
    } catch (error) {
        console.error("Prompts yükleme hatası:", error);
        return [];
    }
}

function savePrompts(prompts: Prompt[]): void {
    try {
        fs.writeFileSync(PROMPTS_PATH, JSON.stringify(prompts, null, 2), "utf-8");
        console.log(`[${new Date().toISOString()}] Prompts kaydedildi: ${PROMPTS_PATH}`);
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

            // İçeriği dosyadan oku
            if (prompt.filePath) {
                try {
                    const fullPath = path.join(__dirname, "..", prompt.filePath);
                    if (fs.existsSync(fullPath)) {
                        prompt.content = fs.readFileSync(fullPath, "utf-8");
                    } else {
                        prompt.content = "(Dosya bulunamadı)";
                    }
                } catch (e) {
                    prompt.content = `(Dosya okuma hatası: ${e})`;
                }
            }

            // Alt promptları getir (varsa) ve içeriklerini yükle
            let result: any = { ...prompt };
            if (prompt.subPrompts && prompt.subPrompts.length > 0) {
                result.resolvedSubPrompts = prompt.subPrompts.map((subId: string) => {
                    const subPrompt = prompts.find(p => p.id === subId);
                    if (subPrompt) {
                        // Alt promptun içeriğini de yükle
                        if (subPrompt.filePath) {
                            try {
                                const subFullPath = path.join(__dirname, "..", subPrompt.filePath);
                                if (fs.existsSync(subFullPath)) {
                                    subPrompt.content = fs.readFileSync(subFullPath, "utf-8");
                                }
                            } catch (e) { }
                        }
                        return subPrompt;
                    }
                    return { id: subId, error: "Alt prompt bulunamadı" };
                });
            }

            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }

        if (name === "add_prompt") {
            const { title, content, tags, subPrompts } = (args as any) || {};
            if (!title || !content) {
                return { content: [{ type: "text", text: "Başlık ve içerik zorunludur" }], isError: true };
            }

            const newId = (prompts.length > 0 ? (Math.max(...prompts.map(p => parseInt(p.id))) + 1).toString() : "1");
            const filename = `${newId}.txt`;
            const relativePath = `prompts/${filename}`;
            const fullPath = path.join(__dirname, "..", relativePath);

            // Klasör var mı kontrol et
            const promptsDir = path.join(__dirname, "..", "prompts");
            if (!fs.existsSync(promptsDir)) {
                fs.mkdirSync(promptsDir);
            }

            // İçeriği dosyaya yaz
            try {
                fs.writeFileSync(fullPath, content, "utf-8");
            } catch (error) {
                return { content: [{ type: "text", text: `Dosya yazma hatası: ${error}` }], isError: true };
            }

            const newPrompt: Prompt = {
                id: newId,
                title,
                // content JSON'a kaydedilmez
                tags: tags || [],
                subPrompts: subPrompts || [],
                filePath: relativePath
            };

            const updatedPrompts = [...prompts, newPrompt];
            savePrompts(updatedPrompts);

            return {
                content: [{
                    type: "text",
                    text: `Prompt başarıyla eklendi. ID: ${newPrompt.id}, Dosya: ${relativePath}`
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
