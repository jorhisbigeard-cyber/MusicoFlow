require('dotenv').config();
require('./setup');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const fs = require('fs');

process.on('unhandledRejection', err => console.error('Unhandled rejection:', err));
process.on('uncaughtException', err => console.error('Uncaught exception:', err));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
for (const file of commandFiles) {
  const command = require(`./commands/${file}`);
  client.commands.set(command.data.name, command);
}

client.once('ready', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);

  // Déployer les commandes slash automatiquement
  try {
    const { REST, Routes } = require('discord.js');
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const commands = [];
    const commandFiles = fs.readdirSync('./commands').filter(f => f.endsWith('.js'));
    for (const file of commandFiles) {
      const command = require(`./commands/${file}`);
      commands.push(command.data.toJSON());
    }
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commandes slash déployées.');
  } catch (err) {
    console.error('Erreur déploiement commandes:', err.message);
  }

  // Statut
  const updateStatus = () => {
    client.user.setActivity(`🎵 ${client.guilds.cache.size} serveurs`, { type: 3 });
  };
  updateStatus();
  setInterval(updateStatus, 60_000);
});

client.on('interactionCreate', async interaction => {
  console.log('Interaction:', interaction.type, interaction.commandName || interaction.customId || '');

  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      const reply = { content: '❌ Une erreur est survenue.', ephemeral: true };
      try { interaction.replied || interaction.deferred ? interaction.followUp(reply) : interaction.reply(reply); } catch {}
    }
  }
  else if (interaction.isButton()) {
    const cmd = client.commands.get('music');
    if (cmd?.handleButton) await cmd.handleButton(interaction).catch(console.error);
  }
  else if (interaction.isModalSubmit()) {
    const cmd = client.commands.get('music');
    if (cmd?.handleModal) await cmd.handleModal(interaction).catch(console.error);
  }
});

client.login(process.env.TOKEN);
