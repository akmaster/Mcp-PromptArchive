import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const promptsPath = path.join(__dirname, 'prompts.json');
const promptsDir = path.join(__dirname, 'prompts');

// Create prompts directory
if (!fs.existsSync(promptsDir)) {
    fs.mkdirSync(promptsDir);
    console.log('Created prompts directory.');
}

// Read index
const prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
const newPrompts = [];

prompts.forEach(prompt => {
    // Check if content exists to avoid overwriting if run multiple times partially
    // But since we want to migrate, we assume content is in JSON if not migrated yet.
    // If we run this on already migrated JSON, content will be undefined, so we check.

    let content = prompt.content;
    let filename = `${prompt.id}.txt`;
    let filePath = path.join(promptsDir, filename);
    let relativePath = `prompts/${filename}`;

    if (content === undefined) {
        // Already migrated? Or just empty?
        // If file exists, maybe we just update index.
        if (fs.existsSync(filePath)) {
            console.log(`Prompt ${prompt.id} already migrated.`);
            newPrompts.push(prompt);
            return;
        }
        content = '';
    }

    // Write content file
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Migrated prompt ${prompt.id} to ${filePath}`);

    // Create new prompt object for index
    const newPrompt = { ...prompt };
    delete newPrompt.content;
    newPrompt.filePath = relativePath;
    newPrompts.push(newPrompt);
});

// Update index file
fs.writeFileSync(promptsPath, JSON.stringify(newPrompts, null, 2), 'utf-8');
console.log('Updated prompts.json index.');
