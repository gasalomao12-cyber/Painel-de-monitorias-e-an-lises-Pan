// Copia as bibliotecas usadas no navegador para public/vendor (o site é estático, sem build).
// Uso: npm install && npm run vendor
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'vendor');
mkdirSync(out, { recursive: true });
const files = {
  'chart.umd.min.js': 'node_modules/chart.js/dist/chart.umd.min.js',
  'supabase.js': 'node_modules/@supabase/supabase-js/dist/umd/supabase.js',
  'exceljs.min.js': 'node_modules/exceljs/dist/exceljs.min.js',
  'mammoth.browser.min.js': 'node_modules/mammoth/mammoth.browser.min.js',
};
for (const [name, src] of Object.entries(files)) {
  copyFileSync(join(root, src), join(out, name));
  console.log(`vendor/${name} <- ${src}`);
}
