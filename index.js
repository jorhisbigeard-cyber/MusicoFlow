require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');

// Télécharger yt-dlp si pas présent
require('./setup');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

// Charger les commandes
const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  console.log('Interaction reçue:', interaction.type, interaction.commandName || interaction.customId || '');
  // Commandes slash
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true });
    }
  }

  // Boutons du panel music
  else if (interaction.isButton()) {
    const musicCommand = client.commands.get('music');
    if (musicCommand?.handleButton) {
      try {
        await musicCommand.handleButton(interaction);
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: '❌ Une erreur est survenue.', ephemeral: true });
      }
    }
  }

  // Modal ajouter musique
  else if (interaction.isModalSubmit()) {
    const musicCommand = client.commands.get('music');
    if (musicCommand?.handleModal) {
      try {
        await musicCommand.handleModal(interaction);
      } catch (err) {
        console.error(err);
      }
    }
  }
});

client.login(process.env.TOKEN);
