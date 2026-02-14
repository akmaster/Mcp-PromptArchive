import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const promptsJsonPath = path.join(__dirname, 'prompts.json');

console.log(`Reading prompts from: ${promptsJsonPath}`);

try {
    const rawData = fs.readFileSync(promptsJsonPath, 'utf-8');
    const prompts = JSON.parse(rawData);

    console.log(`Found ${prompts.length} prompts.`);

    let errors = 0;
    prompts.forEach((prompt: any) => {
        if (prompt.filePath) {
            const absolutePath = path.join(__dirname, prompt.filePath);
            if (!fs.existsSync(absolutePath)) {
                console.error(`[MISSING] Prompt ID ${prompt.id} (${prompt.title}): File ${prompt.filePath} not found at ${absolutePath}`);
                errors++;
            } else {
                console.log(`[OK] Prompt ID ${prompt.id}: ${prompt.filePath}`);
            }
        }
    });

    if (errors === 0) {
        console.log("All prompt files exist locally.");
    } else {
        console.error(`Found ${errors} missing prompt files.`);
    }

} catch (error) {
    console.error("Error reading prompts.json:", error);
}
