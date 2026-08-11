// ─────────────────────────────────────────────────────────────────────────────
// L3X BOT — Discord + DarkGPT API
// GitHub : push ce fichier seul, rien d'autre requis
//
// SETUP :
//   1. Clé API sur https://darkgpt.chat/api-keys
//   2. Crée un .env avec DISCORD_TOKEN et DARKGPT_API_KEY
//   3. node bot.js
//
// SUR RENDER :
//   Environment Variables → DISCORD_TOKEN + DARKGPT_API_KEY
//   Build Command        → npm install
//   Start Command        → node bot.js
// ─────────────────────────────────────────────────────────────────────────────

import { execSync } from 'child_process';
import { existsSync, writeFileSync } from 'fs';

// ─── Auto-install deps ───────────────────────────────────────────────────────

const DEPS = {
  'discord.js': '^14.15.0',
  'dotenv':     '^16.4.0',
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
    'DISCORD_TOKEN=ton_token_discord\nDARKGPT_API_KEY=ta_cle_darkgpt\n'
  );
}

// ─── Charge .env si présent (local) ─────────────────────────────────────────

const { config } = await import('dotenv');
config();

// ─── Validation des variables ────────────────────────────────────────────────

const DISCORD_TOKEN   = process.env.DISCORD_TOKEN;
const DARKGPT_API_KEY = process.env.DARKGPT_API_KEY;

if (!DISCORD_TOKEN) {
  console.error('[L3X] DISCORD_TOKEN manquant — remplis .env ou les variables Render.');
  process.exit(1);
}
if (!DARKGPT_API_KEY) {
  console.error('[L3X] DARKGPT_API_KEY manquante — clé sur https://darkgpt.chat/api-keys');
  process.exit(1);
}

// ─── Config ──────────────────────────────────────────────────────────────────

const ALLOWED_CHANNEL  = '1536622022426099793';
const DARKGPT_BASE_URL = 'https://darkgpt.chat/v1/chat/completions';
const DARKGPT_MODEL    = 'claude-4.6-sonnet';

// ─── Init Discord ────────────────────────────────────────────────────────────

const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } = await import('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

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

// ─── Appel DarkGPT ───────────────────────────────────────────────────────────

const SYSTEM_PROMPT =
  'Tu es L3X, un assistant Discord utile et concis. ' +
  'Réponds toujours en français sauf si on te parle dans une autre langue. ' +
  'Garde tes réponses courtes et directes — tu es dans un chat Discord, pas un document.';

async function askDarkGPT(interaction, prompt) {
  const channelId = interaction.channelId;

  pushAndTrim(channelId, 'user', prompt);

  try {
    await interaction.deferReply();

    const res = await fetch(DARKGPT_BASE_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${DARKGPT_API_KEY}`,
      },
      body: JSON.stringify({
        model:       DARKGPT_MODEL,
        max_tokens:  1024,
        temperature: 0.7,
        messages:    [
          { role: 'system', content: SYSTEM_PROMPT },
          ...getHistory(channelId),
        ],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw Object.assign(new Error(err?.error?.message ?? res.statusText), { status: res.status });
    }

    const data  = await res.json();
    const reply = data.choices?.[0]?.message?.content ?? 'Pas de réponse.';

    pushAndTrim(channelId, 'assistant', reply);

    const chunks = splitMessage(reply);
    await interaction.editReply(chunks[0]);
    for (const chunk of chunks.slice(1)) await interaction.followUp(chunk);

  } catch (err) {
    console.error('[L3X] Erreur API DarkGPT:', err);

    const msg =
      err.status === 429 ? 'Rate limit atteint. Réessaie dans quelques secondes.' :
      err.status === 401 ? 'Clé API invalide — vérifie DARKGPT_API_KEY.'          :
      err.status === 403 ? 'Clé révoquée — génère-en une nouvelle sur darkgpt.chat.' :
      `Erreur inattendue : ${err.message}`;

    try {
      await interaction.editReply(msg);
    } catch {
      await interaction.reply({ content: msg, ephemeral: true });
    }
  }
}

// ─── Enregistrement des slash commands ──────────────────────────────────────

client.once('clientReady', async () => {
  console.log(`[L3X] Connecté : ${client.user.tag}`);
  console.log(`[L3X] Salon autorisé : ${ALLOWED_CHANNEL}`);

  const commands = [
    new SlashCommandBuilder()
      .setName('darkgpt')
      .setDescription('Pose une question à DarkGPT')
      .addStringOption((opt) =>
        opt.setName('prompt')
          .setDescription('Ta question')
          .setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName('reset')
      .setDescription('Efface l\'historique de conversation'),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('[L3X] Slash commands enregistrées : /darkgpt, /reset');
  } catch (err) {
    console.error('[L3X] Erreur enregistrement commands:', err);
  }
});

// ─── Handler interactions ────────────────────────────────────────────────────

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.channelId !== ALLOWED_CHANNEL) {
    await interaction.reply({
      content:   `Cette commande n'est disponible que dans <#${ALLOWED_CHANNEL}>.`,
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'darkgpt') {
    const prompt = interaction.options.getString('prompt');
    await askDarkGPT(interaction, prompt);
    return;
  }

  if (interaction.commandName === 'reset') {
    history.delete(interaction.channelId);
    await interaction.reply('Historique effacé.');
    return;
  }
});

// ─── Connexion ───────────────────────────────────────────────────────────────

client.login(DISCORD_TOKEN);
