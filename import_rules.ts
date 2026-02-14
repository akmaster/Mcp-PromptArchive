import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROMPTS_PATH = path.join(__dirname, 'prompts.json');
const PROMPTS_DIR = path.join(__dirname, 'prompts');

// Dosya Listesi ve Etiketler
// rules.md EN BAŞTA olmalı ki ID'si 1 olsun
const filesToImport = [
    { filename: 'rules.md', tags: ['rules', 'core', 'hub'] },
    { filename: 'asmr_rules.md', tags: ['rules', 'asmr', 'satisfying'] },
    { filename: 'cizgifilm_rules.md', tags: ['rules', 'cartoon', 'animation', 'kids'] },
    { filename: 'fikra_rules.md', tags: ['rules', 'joke', 'comedy', 'sketch'] },
    { filename: 'film_rules.md', tags: ['rules', 'film', 'cinema', 'movie'] },
    { filename: 'karikatur_rules.md', tags: ['rules', 'caricature', 'comic', 'humor'] },
    { filename: 'klip_rules.md', tags: ['rules', 'clip', 'music_video', 'music'] },
    { filename: 'senaryo.md', tags: ['rules', 'scenario', 'scriptwriting'] }
];

interface Prompt {
    id: string;
    title: string;
    tags: string[];
    subPrompts: string[];
    filePath: string;
}

// Prompts.json başlat (Üzerine yazacağız, reset istendiği için)
let prompts: Prompt[] = [];

// Prompts klasörü yoksa oluştur
if (!fs.existsSync(PROMPTS_DIR)) {
    fs.mkdirSync(PROMPTS_DIR, { recursive: true });
}

console.log(`Starting import of ${filesToImport.length} files...`);

filesToImport.forEach(item => {
    const sourcePath = path.join(__dirname, item.filename);

    if (!fs.existsSync(sourcePath)) {
        console.error(`[SKIP] Source file not found: ${sourcePath}`);
        return;
    }

    const content = fs.readFileSync(sourcePath, 'utf-8');

    // Başlığı çıkar (İlk satırdaki # sonrası)
    const titleMatch = content.match(/^#\s+(.+)$/m);
    let title = titleMatch ? titleMatch[1].trim() : item.filename;

    // Yeni ID oluştur (Sıralı artan)
    const newId = (prompts.length + 1).toString();

    // Dosya adı oluştur
    const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const targetFilename = `${newId}_${sanitizedTitle}.md`;
    const targetPath = path.join(PROMPTS_DIR, targetFilename);

    // İçeriği hedef dosyaya yaz
    fs.writeFileSync(targetPath, content, 'utf-8');
    console.log(`[OK] Imported ${item.filename} -> prompts/${targetFilename}`);

    // Prompts dizisine ekle
    prompts.push({
        id: newId,
        title: title,
        tags: item.tags,
        subPrompts: [],
        filePath: targetFilename
    });
});

// ID 1 olan (rules.md) ana kural dosyasıdır.
// Diğer tüm dosyalar (rules.md hariç) ona referans vermelidir.
const mainRulesId = "1";

prompts.forEach(p => {
    if (p.id !== mainRulesId) {
        p.subPrompts = [mainRulesId];
    }
});

fs.writeFileSync(PROMPTS_PATH, JSON.stringify(prompts, null, 2), 'utf-8');
console.log("Import completed. prompts.json updated.");
