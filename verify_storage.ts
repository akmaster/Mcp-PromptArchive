import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPTS_PATH = path.join(__dirname, 'prompts.json');
const PROMPTS_DIR = path.join(__dirname, 'prompts');

console.log(`[TEST] PROMPTS_PATH: ${PROMPTS_PATH}`);
console.log(`[TEST] PROMPTS_DIR: ${PROMPTS_DIR}`);

// 1. Clean up
if (fs.existsSync(PROMPTS_PATH)) fs.unlinkSync(PROMPTS_PATH);
if (fs.existsSync(PROMPTS_DIR)) fs.rmSync(PROMPTS_DIR, { recursive: true, force: true });

fs.mkdirSync(PROMPTS_DIR);
fs.writeFileSync(PROMPTS_PATH, '[]');

// 2. Test add_prompt logic
const title = "Test Prompt";
const content = "# Test Content";
const prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf-8'));
const newId = (prompts.length > 0 ? (Math.max(...prompts.map((p: any) => parseInt(p.id))) + 1).toString() : "1");
const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
const fileName = `${newId}_${sanitizedTitle}.md`;
const filePath = path.join(PROMPTS_DIR, fileName);

console.log(`[TEST] Writing to file: ${filePath}`);
fs.writeFileSync(filePath, content, "utf-8");

const newPrompt = {
    id: newId,
    title,
    tags: ["test"],
    filePath: fileName
};

prompts.push(newPrompt);
fs.writeFileSync(PROMPTS_PATH, JSON.stringify(prompts, null, 2));

// 3. Verify file exists
if (fs.existsSync(filePath)) {
    console.log("[PASS] File created successfully.");
} else {
    console.error("[FAIL] File not created.");
}

// 4. Test get_prompt logic
const loadedPrompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf-8'));
const prompt = loadedPrompts.find((p: any) => p.id === newId);

if (prompt) {
    let finalContent = "";
    if (prompt.filePath) {
        const absoluteFilePath = path.join(PROMPTS_DIR, prompt.filePath);
        if (fs.existsSync(absoluteFilePath)) {
            finalContent = fs.readFileSync(absoluteFilePath, "utf-8");
        }
    }

    if (finalContent === content) {
        console.log("[PASS] Content read successfully.");
    } else {
        console.error(`[FAIL] Content mismatch. Expected: ${content}, Got: ${finalContent}`);
    }
} else {
    console.error("[FAIL] Prompt not found in JSON.");
}
