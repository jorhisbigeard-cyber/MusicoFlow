require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { Manager } = require('moonlink.js');
const fs = require('fs');

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

// Nodes Lavalink publics
client.manager = new Manager(
  {
    nodes: [
      { host: 'lava-v4.ajieblogs.eu.org', port: 80, password: 'https://dsc.gg/ajidevserver', secure: false },
    ],
    clientName: 'MusicoFlow',
    sendPayload: (guildId, payload) => {
      const guild = client.guilds.cache.get(guildId);
      if (guild) guild.shard.send(JSON.parse(payload));
    },
  }
);

client.manager.on('nodeCreate', node => console.log(`✅ Node connecté: ${node.host}`));
client.manager.on('nodeError', (node, err) => console.error(`❌ Node erreur: ${node.host}`, err));

client.manager.on('trackStart', (player, track) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (channel) {
    const { buildEmbed, buildButtons } = require('./commands/music');
    channel.send({ embeds: [buildEmbed(track)], components: [buildButtons(false)] })
      .then(msg => { player.panelMessage = msg; })
      .catch(() => {});
  }
});

client.manager.on('trackEnd', player => {
  if (player.panelMessage) {
    player.panelMessage.delete().catch(() => {});
    player.panelMessage = null;
  }
});

client.once('ready', () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  client.manager.init(client.user.id);
});

client.on('raw', data => client.manager.packetUpdate(data));

client.on('interactionCreate', async interaction => {
  console.log('Interaction reçue:', interaction.type, interaction.commandName || interaction.customId || '');

  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client);
    } catch (err) {
      console.error(err);
      const reply = { content: '❌ Une erreur est survenue.', ephemeral: true };
      interaction.replied ? interaction.followUp(reply) : interaction.reply(reply);
    }
  }

  else if (interaction.isButton()) {
    const musicCommand = client.commands.get('music');
    if (musicCommand?.handleButton) {
      try { await musicCommand.handleButton(interaction, client); }
      catch (err) { console.error(err); }
    }
  }

  else if (interaction.isModalSubmit()) {
    const musicCommand = client.commands.get('music');
    if (musicCommand?.handleModal) {
      try { await musicCommand.handleModal(interaction, client); }
      catch (err) { console.error(err); }
    }
  }
});

client.login(process.env.TOKEN);
