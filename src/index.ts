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
    content?: string; // Artık opsiyonel, dosyadan yüklenebilir
    tags: string[];
    subPrompts?: string[]; // Referans verilen diğer prompt ID'leri
    filePath?: string; // İçeriğin bulunduğu dosya yolu (prompts.json'a göre relatif veya mutlak)
}

// Veri dosyası konumu: Çalıştırılan komutun dizininden bağımsız olarak, 
// projenin kök dizinindeki (src veya dist'in bir üstü) prompts.json'ı hedefler.
let PROMPTS_PATH = process.env.PROMPTS_PATH || path.join(__dirname, "..", "prompts.json");
// Prompts klasörü yolu
let PROMPTS_DIR = path.join(path.dirname(PROMPTS_PATH), "prompts");

// Eğer varsayılan yol bulunamazsa, CWD (Current Working Directory) üzerinden dene
if (!process.env.PROMPTS_PATH && !fs.existsSync(PROMPTS_PATH)) {
    const cwdPath = path.join(process.cwd(), "prompts.json");
    if (fs.existsSync(cwdPath)) {
        PROMPTS_PATH = cwdPath;
        PROMPTS_DIR = path.join(process.cwd(), "prompts");
    }
}

// Mutlak yol olduğundan emin ol
PROMPTS_PATH = path.resolve(PROMPTS_PATH);
PROMPTS_DIR = path.resolve(PROMPTS_DIR);

// Prompts klasörünü oluştur
if (!fs.existsSync(PROMPTS_DIR)) {
    fs.mkdirSync(PROMPTS_DIR, { recursive: true });
}

console.log(`[INIT] Prompts dosyası yolu: ${PROMPTS_PATH}`);
console.log(`[INIT] Prompts klasörü yolu: ${PROMPTS_DIR}`);

function loadPrompts(): Prompt[] {
    try {
        if (!fs.existsSync(PROMPTS_PATH)) {
            console.error(`[ERROR] prompts.json bulunamadı: ${PROMPTS_PATH}`);
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
        version: "1.0.2"
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
        { name: "prompt-archive-server", version: "1.0.2" },
        { capabilities: { tools: {} } }
    );

    // Araçları Tanımla (Low-level API)
    server.setRequestHandler(ListToolsRequestSchema, async () => {
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

            // İçerik yükleme: Önce dosyaya bak, yoksa content alanına bak
            let finalContent = prompt.content || "";
            if (prompt.filePath) {
                try {
                    // filePath relative ise PROMPTS_DIR ile birleştir, absolute ise direk kullan
                    const absoluteFilePath = path.isAbsolute(prompt.filePath)
                        ? prompt.filePath
                        : path.join(PROMPTS_DIR, path.basename(prompt.filePath));

                    if (fs.existsSync(absoluteFilePath)) {
                        finalContent = fs.readFileSync(absoluteFilePath, "utf-8");
                    } else {
                        console.warn(`[WARN] Prompt dosyası bulunamadı: ${absoluteFilePath}`);
                        finalContent += "\n[HATA: Dosya bulunamadı]";
                    }
                } catch (err) {
                    console.error("Dosya okuma hatası:", err);
                    finalContent += "\n[HATA: Dosya okunamadı]";
                }
            }

            // Alt promptları getir (varsa)
            let result: any = { ...prompt, content: finalContent };
            if (prompt.subPrompts && prompt.subPrompts.length > 0) {
                result.resolvedSubPrompts = prompt.subPrompts.map((subId: string) => {
                    const subPrompt = prompts.find(p => p.id === subId);
                    if (subPrompt) {
                        return { title: subPrompt.title, id: subPrompt.id }; // Sadece başlık ve ID dönmek yeterli olabilir, içeriği gömmek yerine
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

            // Dosya ismi oluştur: ID_Title.md (Title'ı sanitize et)
            const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            const fileName = `${newId}_${sanitizedTitle}.md`;
            const filePath = path.join(PROMPTS_DIR, fileName);

            // İçeriği dosyaya yaz
            try {
                fs.writeFileSync(filePath, content, "utf-8");
            } catch (err) {
                console.error("Dosya yazma hatası:", err);
                return { content: [{ type: "text", text: "Dosya oluşturulamadı: " + err }], isError: true };
            }

            const newPrompt: Prompt = {
                id: newId,
                title,
                tags: tags || [],
                subPrompts: subPrompts || [],
                filePath: fileName // Sadece dosya adını saklıyoruz, path join ile bulunur
                // content alanını bilerek boş bırakıyoruz veya opsiyonel yapıyoruz
            };

            const updatedPrompts = [...prompts, newPrompt];
            savePrompts(updatedPrompts);

            return {
                content: [{
                    type: "text",
                    text: `Prompt başarıyla eklendi. ID: ${newPrompt.id}, Dosya: ${fileName}`
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
