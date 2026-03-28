require('dotenv').config();
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const { LavalinkManager } = require('lavalink-client');
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

client.lavalink = new LavalinkManager({
  nodes: [
    { host: 'lava-v4.ajieblogs.eu.org', port: 80, authorization: 'https://dsc.gg/ajidevserver', secure: false, id: 'node1' },
  ],
  sendToShard: (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(payload);
  },
  client: { id: process.env.CLIENT_ID, username: 'MusicoFlow' },
});

client.lavalink.nodeManager.on('connect', node => console.log(`✅ Node connecté: ${node.id}`));
client.lavalink.nodeManager.on('error', (node, err) => console.error(`❌ Node erreur: ${node.id}`, err.message));

client.lavalink.on('trackStart', (player, track) => {
  const channel = client.channels.cache.get(player.textChannelId);
  if (!channel) return;
  const { buildEmbed, buildButtons } = require('./commands/music');
  channel.send({ embeds: [buildEmbed(track)], components: [buildButtons(false)] })
    .then(msg => { player.panelMessage = msg; })
    .catch(() => {});
});

client.lavalink.on('trackEnd', player => {
  if (player.panelMessage) {
    player.panelMessage.delete().catch(() => {});
    player.panelMessage = null;
  }
});

client.once('ready', async () => {
  console.log(`✅ Bot connecté en tant que ${client.user.tag}`);
  await client.lavalink.init({ id: client.user.id, username: client.user.username });
});

client.on('raw', d => client.lavalink.sendRawData(d));

client.on('interactionCreate', async interaction => {
  console.log('Interaction:', interaction.type, interaction.commandName || interaction.customId || '');

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
    const cmd = client.commands.get('music');
    if (cmd?.handleButton) await cmd.handleButton(interaction, client).catch(console.error);
  }
  else if (interaction.isModalSubmit()) {
    const cmd = client.commands.get('music');
    if (cmd?.handleModal) await cmd.handleModal(interaction, client).catch(console.error);
  }
});

client.login(process.env.TOKEN);
