const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

function buildEmbed(track, isPaused = false) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(isPaused ? '⏸️ En pause' : '🎵 En cours de lecture')
    .setDescription(`**[${track.title}](${track.uri})**`)
    .setThumbnail(track.artworkUrl || track.thumbnail || '')
    .addFields({ name: 'Durée', value: track.duration ? new Date(track.duration).toISOString().substr(11, 8).replace(/^00:/, '') : '??:??', inline: true });
}

function buildButtons(isPaused = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('pause_resume').setLabel(isPaused ? '▶️ Reprendre' : '⏸️ Pause').setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('skip').setLabel('⏭️ Skip').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('stop').setLabel('⏹️ Stop').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('queue').setLabel('📋 File').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('add_song').setLabel('➕ Ajouter').setStyle(ButtonStyle.Success),
  );
}

async function playQuery(query, interaction, client) {
  const voiceChannel = interaction.member.voice.channel;
  if (!voiceChannel)
    return interaction.editReply('❌ Tu dois être dans un salon vocal.');

  let player = client.manager.players.get(interaction.guildId);
  if (!player) {
    player = client.manager.create({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
      autoPlay: true,
    });
  }

  if (!player.connected) await player.connect();

  const res = await client.manager.search(query);
  if (!res || !res.tracks?.length)
    return interaction.editReply('❌ Aucun résultat trouvé.');

  const track = res.tracks[0];
  player.queue.add(track);

  if (!player.playing && !player.paused) {
    player.play();
    await interaction.editReply({ embeds: [buildEmbed(track)], components: [buildButtons()] });
  } else {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('➕ Ajouté à la file')
        .setDescription(`**[${track.title}](${track.uri})**`)
        .addFields({ name: 'Position', value: `${player.queue.size}`, inline: true })],
    });
  }
}

module.exports = {
  buildEmbed,
  buildButtons,

  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Commandes music')
    .addSubcommand(sub =>
      sub.setName('play')
        .setDescription('Jouer une musique')
        .addStringOption(opt =>
          opt.setName('query').setDescription('Nom ou URL YouTube').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('queue').setDescription("Voir la file d'attente")),

  async execute(interaction, client) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;

    if (sub === 'play') {
      await interaction.deferReply();
      const query = interaction.options.getString('query');
      await playQuery(query, interaction, client);
    }

    else if (sub === 'queue') {
      const player = client.manager.players.get(guildId);
      if (!player || !player.queue.size)
        return interaction.reply({ content: '📭 La file est vide.', ephemeral: true });

      const list = player.queue.map((t, i) => `${i === 0 ? '▶️' : `${i}.`} **${t.title}**`).join('\n');
      interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📋 File d'attente").setDescription(list.slice(0, 4096))],
        ephemeral: true,
      });
    }
  },

  async handleButton(interaction, client) {
    const guildId = interaction.guildId;
    const id = interaction.customId;

    if (id === 'add_song') {
      const modal = new ModalBuilder().setCustomId('add_song_modal').setTitle('Ajouter une musique');
      const input = new TextInputBuilder().setCustomId('song_query').setLabel('Nom ou URL YouTube')
        .setStyle(TextInputStyle.Short).setPlaceholder('Ex: Never Gonna Give You Up').setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return await interaction.showModal(modal);
    }

    const player = client.manager.players.get(guildId);
    if (!player) return interaction.reply({ content: '❌ Aucune musique en cours.', ephemeral: true });

    if (id === 'pause_resume') {
      player.paused ? player.resume() : player.pause();
      const track = player.current;
      await interaction.update({ embeds: [buildEmbed(track, player.paused)], components: [buildButtons(player.paused)] });
    }
    else if (id === 'skip') {
      player.stop();
      await interaction.reply({ content: '⏭️ Musique passée.', ephemeral: true });
    }
    else if (id === 'stop') {
      player.destroy();
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('⏹️ Arrêté').setDescription('File vidée.')],
        components: [],
      });
    }
    else if (id === 'queue') {
      const list = player.queue.map((t, i) => `${i === 0 ? '▶️' : `${i}.`} **${t.title}**`).join('\n') || 'File vide.';
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📋 File d'attente").setDescription(list.slice(0, 4096))],
        ephemeral: true,
      });
    }
  },

  async handleModal(interaction, client) {
    if (interaction.customId !== 'add_song_modal') return;
    await interaction.deferReply({ ephemeral: true });
    const query = interaction.fields.getTextInputValue('song_query');
    await playQuery(query, interaction, client);
  },
};
