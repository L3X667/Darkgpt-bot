// ───────────────────────────────────────────────────────────────────────────── 
// L3X BOT — Discord + Claude API
// GitHub : push ce fichier seul, rien d'autre requis
//
// SETUP :
//   1. Copie .env.example → .env et remplis les deux valeurs
//   2. node bot.js
//
// SUR RENDER :
//   Environment Variables → DISCORD_TOKEN + ANTHROPIC_API_KEY
//   Start Command        → node bot.js
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';

// ─── Auto-install deps ───────────────────────────────────────────────────────

const DEPS = {
  'discord.js':        '^14.15.0',
  '@anthropic-ai/sdk': '^0.27.0',
  'dotenv':            '^16.4.0',
};

const missing = Object.keys(DEPS).filter(
  (pkg) => !existsSync(`./node_modules/${pkg}`)
);

if (missing.length > 0) {
  const pkgList = missing.map((p) => `${p}@"${DEPS[p]}"`).join(' ');
  console.log(`[L3X] Installation : ${missing.join(', ')}`);
  execSync(`npm install ${pkgList}`, { stdio: 'inherit' });
}

// ─── Génère .env.example si absent ──────────────────────────────────────────

if (!existsSync('./.env.example')) {
  writeFileSync(
    './.env.example',
    'DISCORD_TOKEN=ton_token_discord\nANTHROPIC_API_KEY=ta_cle_anthropic\n'
  );
}

// ─── Charge .env si présent (local) ─────────────────────────────────────────

const { config } = await import('dotenv');
config();

// ─── Validation des variables ────────────────────────────────────────────────

const DISCORD_TOKEN     = process.env.DISCORD_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!DISCORD_TOKEN) {
  console.error('[L3X] DISCORD_TOKEN manquant — remplis .env ou les variables Render.');
  process.exit(1);
}
if (!ANTHROPIC_API_KEY) {
  console.error('[L3X] ANTHROPIC_API_KEY manquante — remplis .env ou les variables Render.');
  process.exit(1);
}

// ─── Init clients ────────────────────────────────────────────────────────────

const { Client, GatewayIntentBits } = await import('discord.js');
const { default: Anthropic }        = await import('@anthropic-ai/sdk');

const client    = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ─── Historique par channel (max 20 messages) ────────────────────────────────

const history     = new Map();
const MAX_HISTORY = 20;

function getHistory(channelId) {
  if (!history.has(channelId)) history.set(channelId, []);
  return history.get(channelId);
}

function pushAndTrim(channelId, role, content) {
  const h = getHistory(channelId);
  h.push({ role, content });
  if (h.length > MAX_HISTORY) h.splice(0, h.length - MAX_HISTORY);
}

// ─── Split messages > 2000 chars (limite Discord) ───────────────────────────

function splitMessage(text, max = 2000) {
  const chunks = [];
  let current  = '';
  for (const line of text.split('\n')) {
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > max) {
      if (current) chunks.push(current.trim());
      current = line;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current.trim());
  return chunks;
}

// ─── Appel Claude ────────────────────────────────────────────────────────────

async function askClaude(message, prompt) {
  const channelId = message.channel.id;

  pushAndTrim(channelId, 'user', prompt);

  let typingInterval;
  try {
    await message.channel.sendTyping();
    typingInterval = setInterval(() => message.channel.sendTyping(), 8000);

    const res = await anthropic.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 1024,
      system:
        'Tu es L3X, un assistant Discord utile et concis. ' +
        'Réponds toujours en français sauf si on te parle dans une autre langue. ' +
        'Garde tes réponses courtes et directes — tu es dans un chat Discord, pas un document.',
      messages: getHistory(channelId),
    });

    clearInterval(typingInterval);

    const reply = res.content
      .filter((b) => b.type === 'text')
      .map((b)  => b.text)
      .join('\n');

    pushAndTrim(channelId, 'assistant', reply);

    const chunks = splitMessage(reply);
    await message.reply(chunks[0]);
    for (const chunk of chunks.slice(1)) await message.channel.send(chunk);

  } catch (err) {
    clearInterval(typingInterval);
    console.error('[L3X] Erreur API Anthropic:', err);

    const msg =
      err.status === 429 ? 'Rate limit atteint. Réessaie dans quelques secondes.' :
      err.status === 401 ? 'Clé API invalide — vérifie ANTHROPIC_API_KEY.'        :
      `Erreur inattendue : ${err.message}`;

    await message.reply(msg);
  }
}

// ─── Events Discord ──────────────────────────────────────────────────────────

client.once('ready', () => {
  console.log(`[L3X] Connecté : ${client.user.tag}`);
  console.log('[L3X] Commandes : !claude [prompt] | !reset');
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content;

  // !claude [prompt] — pose une question à Claude
  if (content.startsWith('!claude ')) {
    const prompt = content.slice(8).trim();
    if (!prompt) { await message.reply('Prompt vide.'); return; }
    await askClaude(message, prompt);
    return;
  }

  // !reset — efface l'historique du channel
  if (content === '!reset') {
    history.delete(message.channel.id);
    await message.reply('Historique effacé.');
    return;
  }
});

// ─── Connexion ───────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN);

