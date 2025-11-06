#!/usr/bin/env node
/**
 * Script per generare config.js da variabile d'ambiente
 * Usato durante il build su Vercel
 */

const fs = require('fs');
const path = require('path');

// Leggi la chiave da variabile d'ambiente
const apiKey = process.env.FIREBASE_API_KEY;

if (!apiKey) {
  console.error('❌ ERRORE: Variabile d\'ambiente FIREBASE_API_KEY non trovata!');
  console.error('   Configurala su Vercel Dashboard → Settings → Environment Variables');
  process.exit(1);
}

// Template del file config.js
const configContent = `/**
 * 🔒 CONFIGURAZIONE FIREBASE API KEY
 *
 * ⚠️ Questo file è generato automaticamente durante il build
 * NON modificare manualmente - verrà sovrascritto
 */

const FIREBASE_API_KEY = "${apiKey}";
`;

// Scrivi il file
const configPath = path.join(__dirname, 'config.js');
fs.writeFileSync(configPath, configContent, 'utf8');

console.log('✅ config.js generato con successo!');
console.log(`   Chiave API: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)}`);
