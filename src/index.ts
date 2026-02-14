import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";

// Prompt veri tipi
interface Prompt {
    id: string;
    title: string;
    content: string;
    tags: string[];
}

// Veri yükleme fonksiyonu
function loadPrompts(): Prompt[] {
    try {
        const promptsPath = path.join(process.cwd(), "prompts.json");
        if (!fs.existsSync(promptsPath)) {
            console.warn("prompts.json bulunamadı, boş liste dönülüyor.");
            return [];
        }
        const data = fs.readFileSync(promptsPath, "utf-8");
        return JSON.parse(data);
    } catch (error) {
        console.error("Prompts yüklenirken hata:", error);
        return [];
    }
}

// Her bağlantı için yeni bir McpServer oluşturan fabrika fonksiyonu
function createServer(): McpServer {
    const server = new McpServer({
        name: "Prompt Archive",
        version: "1.0.0",
    });

    // Araç: Promptları listele
    server.tool(
        "list_prompts",
        {},
        async () => {
            const prompts = loadPrompts();
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify(
                            prompts.map((p) => ({ id: p.id, title: p.title, tags: p.tags })),
                            null,
                            2
                        ),
                    },
                ],
            };
        }
    );

    // Araç: ID ile prompt getir
    server.tool(
        "get_prompt",
        { id: { type: "string" } as any },
        async ({ id }: { id: string }) => {
            const prompts = loadPrompts();
            const prompt = prompts.find((p) => p.id === id);
            if (!prompt) {
                return {
                    content: [
                        { type: "text", text: `Prompt with ID ${id} not found.` },
                    ],
                    isError: true,
                };
            }
            return {
                content: [{ type: "text", text: JSON.stringify(prompt, null, 2) }],
            };
        }
    );

    return server;
}

const app = express();
app.use(cors());

// Transport yönetimi: sessionId -> transport eşleşmesi
const transports = new Map<string, SSEServerTransport>();

// Health check endpoint
app.get("/", (_req, res) => {
    res.json({ status: "ok", name: "Prompt Archive MCP Server" });
});

// SSE Endpoint — her bağlantıda yeni bir McpServer oluşturulur
app.get("/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;

    transports.set(sessionId, transport);
    console.log(`New session started: ${sessionId}`);

    // Bağlantı kapandığında temizle
    res.on("close", () => {
        transports.delete(sessionId);
        console.log(`Session closed: ${sessionId}`);
    });

    // Her oturum için bağımsız bir McpServer oluştur ve bağla
    const server = createServer();
    await server.connect(transport);
});

// Mesaj alma endpoint'i
app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    if (!sessionId) {
        res.status(400).send("Session ID required");
        return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
        res.status(404).send("Session not found");
        return;
    }

    await transport.handlePostMessage(req, res);
});

// Render PORT dinleme
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
