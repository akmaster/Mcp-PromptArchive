import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to simulate the Server request handler logic from dist/index.js
// We can't easily import the Server class and mock everything, so we'll 
// basically copy-paste the relevant logic from the *compiled* output or 
// just re-implement the fallback logic here to PROVE it works in this environment.

// HOWEVER, to be more robust, let's try to import the compiled `loadPrompts` 
// or similar if exported? They are not exported.

// So we will simulate the EXACT fallback logic we wrote to ensure it works
// when run in this environment.

const PROMPTS_PATH = path.join(__dirname, 'prompts.json');
const PROMPTS_DIR = path.join(__dirname, 'prompts');

console.log(`PROMPTS_DIR: ${PROMPTS_DIR}`);

const promptId = '3';
const prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf-8'));
const prompt = prompts.find((p: any) => p.id === promptId);

if (!prompt) {
    console.error("Prompt 3 not found");
    process.exit(1);
}

const absoluteFilePath = path.join(PROMPTS_DIR, path.basename(prompt.filePath));
console.log(`Checking path: ${absoluteFilePath}`);

if (fs.existsSync(absoluteFilePath)) {
    console.log("Direct exist check: PASS (Unexpected? expected fail if previous used failed)");
} else {
    console.log("Direct exist check: FAIL (Expected behavior for the bug)");
}

// NOW TEST FALLBACK
console.log("--- Testing Fallback Logic ---");
try {
    const files = fs.readdirSync(PROMPTS_DIR);
    const targetName = path.basename(prompt.filePath);

    // 1. Exact match in listing
    let foundFile = files.find(f => f === targetName);
    if (foundFile) console.log(`[1] Found by exact string in readdir: ${foundFile}`);
    else console.log(`[1] Not found by exact string in readdir`);

    // 2. Starts with ID
    if (!foundFile) {
        foundFile = files.find(f => f.startsWith(`${prompt.id}_`));
        if (foundFile) console.log(`[2] Found by ID prefix: ${foundFile}`);
    }

    if (foundFile) {
        const fallbackPath = path.join(PROMPTS_DIR, foundFile);
        const content = fs.readFileSync(fallbackPath, 'utf-8');
        console.log(`SUCCESS: Read file via fallback at ${fallbackPath}`);
        console.log(`Content length: ${content.length}`);
    } else {
        console.error("FAIL: Fallback also failed to find file.");
    }

} catch (e) {
    console.error(e);
}
