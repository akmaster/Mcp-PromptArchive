import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simulate the logic in src/index.ts
// Assuming this script is run from project root, so __dirname is root.
// src/index.ts is in src, so it does ..
// Let's deduce PROMPTS_DIR based on where prompts.json is.

const PROMPTS_PATH = path.join(__dirname, 'prompts.json');
const PROMPTS_DIR = path.join(__dirname, 'prompts');

console.log(`PROMPTS_PATH: ${PROMPTS_PATH}`);
console.log(`PROMPTS_DIR: ${PROMPTS_DIR}`);

if (!fs.existsSync(PROMPTS_PATH)) {
    console.error("prompts.json not found!");
    process.exit(1);
}

const prompts = JSON.parse(fs.readFileSync(PROMPTS_PATH, 'utf-8'));
const prompt = prompts.find((p: any) => p.id === '3');

if (!prompt) {
    console.error("Prompt ID 3 not found in json");
    process.exit(1);
}

console.log("Found prompt in JSON:", prompt);

const filePath = prompt.filePath;
const absoluteFilePath = path.join(PROMPTS_DIR, filePath);

console.log(`Checking file path: ${absoluteFilePath}`);

if (fs.existsSync(absoluteFilePath)) {
    console.log("PASS: File exists.");
} else {
    console.log("FAIL: File does NOT exist.");

    // List directory to see what's there
    console.log("Directory contents:");
    fs.readdirSync(PROMPTS_DIR).forEach(file => {
        console.log(` - ${file} (len: ${file.length})`);
        if (file.includes('3')) {
            console.log(`   Compare: '${file}' vs '${filePath}'`);
            console.log(`   Equal? ${file === filePath}`);

            // Compare char codes
            for (let i = 0; i < Math.max(file.length, filePath.length); i++) {
                if (file.charCodeAt(i) !== filePath.charCodeAt(i)) {
                    console.log(`   Mismatch at ${i}: dir(${file.charCodeAt(i)}) vs json(${filePath.charCodeAt(i)})`);
                }
            }
        }
    });
}
