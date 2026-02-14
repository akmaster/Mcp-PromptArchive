import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const promptsPath = path.join(__dirname, 'prompts.json');
const promptsDir = path.join(__dirname, 'prompts');

// Ensure prompts directory exists
if (!fs.existsSync(promptsDir)) {
    fs.mkdirSync(promptsDir);
}

// Read current prompts index
let prompts = [];
if (fs.existsSync(promptsPath)) {
    try {
        prompts = JSON.parse(fs.readFileSync(promptsPath, 'utf-8'));
    } catch (e) {
        console.error("Error reading prompts.json", e);
        prompts = [];
    }
}

// Helper to get next ID
const getNextId = () => {
    if (prompts.length === 0) return "1";
    const maxId = Math.max(...prompts.map(p => parseInt(p.id)));
    return (maxId + 1).toString();
};

const importFile = (filePath, tags) => {
    const fileName = path.basename(filePath);
    const title = fileName.replace('.md', '').replace(/_/g, ' ').replace(/-/g, ' '); // Simple title formatting

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const id = getNextId();
        const destFilename = `${id}.txt`;
        const destPath = path.join(promptsDir, destFilename);
        const relativePath = `prompts/${destFilename}`;

        // Write content to destination
        fs.writeFileSync(destPath, content, 'utf-8');
        console.log(`Imported ${fileName} as ID ${id}`);

        // Update index
        prompts.push({
            id: id,
            title: title,
            tags: tags,
            filePath: relativePath
        });

    } catch (error) {
        console.error(`Error importing ${filePath}:`, error);
    }
};

// Directories to import
const sourceDirs = [
    { path: path.join(__dirname, '.agent', 'rules'), tags: ['rules', 'agent'] },
    { path: path.join(__dirname, 'kurallar'), tags: ['rules', 'kurallar'] }
];

sourceDirs.forEach(dirInfo => {
    if (fs.existsSync(dirInfo.path)) {
        const files = fs.readdirSync(dirInfo.path);
        files.forEach(file => {
            if (file.endsWith('.md')) { // Only md files
                importFile(path.join(dirInfo.path, file), dirInfo.tags);
            }
        });
    } else {
        console.log(`Directory not found: ${dirInfo.path}`);
    }
});

// Save updated index
fs.writeFileSync(promptsPath, JSON.stringify(prompts, null, 2), 'utf-8');
console.log('Import complete. prompts.json updated.');
