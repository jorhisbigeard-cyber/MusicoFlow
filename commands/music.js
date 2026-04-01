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
  const dur = track.info?.duration
    ? new Date(track.info.duration).toISOString().substr(11, 8).replace(/^00:/, '')
    : '??:??';
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(isPaused ? '⏸️ En pause' : '🎵 En cours de lecture')
    .setDescription(`**[${track.info?.title || 'Inconnu'}](${track.info?.uri || ''})**`)
    .setThumbnail(track.info?.artworkUrl || '')
    .addFields({ name: 'Durée', value: dur, inline: true });
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
  if (!voiceChannel) return interaction.editReply('❌ Tu dois être dans un salon vocal.');

  // Vérifier que le node est prêt
  const nodes = client.lavalink.nodeManager.nodes;
  const readyNode = [...nodes.values()].find(n => n.connected);
  if (!readyNode) return interaction.editReply('❌ Serveur audio non disponible, réessaie dans quelques secondes.');

  let player = client.lavalink.getPlayer(interaction.guildId);
  if (!player) {
    player = await client.lavalink.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
      selfDeaf: true,
      volume: 80,
    });
  }

  if (!player.connected) await player.connect();

  const isUrl = /^https?:\/\//.test(query);
  const search = isUrl ? query : `ytsearch:${query}`;
  console.log('Searching:', search);

  const res = await player.search({ query: search }, interaction.user);
  console.log('Result:', res?.loadType, res?.tracks?.length);

  if (!res || !res.tracks?.length) return interaction.editReply('❌ Aucun résultat trouvé.');

  const track = res.tracks[0];
  await player.queue.add(track);

  if (!player.playing) {
    const msg = await interaction.editReply({ content: '🔍 Chargement...' });
    player.panelMessage = msg;
    await player.play({ paused: false });
  } else {
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('➕ Ajouté à la file')
        .setDescription(`**[${track.info?.title}](${track.info?.uri})**`)
        .addFields({ name: 'Position', value: `${player.queue.tracks.length}`, inline: true })],
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
    if (sub === 'play') {
      await interaction.deferReply();
      await playQuery(interaction.options.getString('query'), interaction, client);
    }
    else if (sub === 'queue') {
      const player = client.lavalink.getPlayer(interaction.guildId);
      if (!player?.queue?.tracks?.length)
        return interaction.reply({ content: '📭 La file est vide.', ephemeral: true });
      const list = player.queue.tracks.map((t, i) => `${i + 1}. **${t.info?.title}**`).join('\n');
      interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📋 File d'attente").setDescription(list.slice(0, 4096))], ephemeral: true });
    }
  },

  async handleButton(interaction, client) {
    const id = interaction.customId;
    if (id === 'add_song') {
      const modal = new ModalBuilder().setCustomId('add_song_modal').setTitle('Ajouter une musique');
      modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('song_query').setLabel('Nom ou URL YouTube')
          .setStyle(TextInputStyle.Short).setPlaceholder('Ex: Never Gonna Give You Up').setRequired(true)
      ));
      return await interaction.showModal(modal);
    }

    const player = client.lavalink.getPlayer(interaction.guildId);
    if (!player) return interaction.reply({ content: '❌ Aucune musique en cours.', ephemeral: true });

    if (id === 'pause_resume') {
      await player.pause(!player.paused);
      const track = player.queue.current;
      if (!track) return interaction.reply({ content: '❌ Aucune musique en cours.', ephemeral: true });
      await interaction.update({ embeds: [buildEmbed(track, player.paused)], components: [buildButtons(player.paused)] });
    }
    else if (id === 'skip') {
      await player.skip();
      await interaction.reply({ content: '⏭️ Musique passée.', ephemeral: true });
    }
    else if (id === 'stop') {
      try {
        await player.destroy();
      } catch {}
      await interaction.update({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('⏹️ Arrêté').setDescription('File vidée.')], components: [] });
    }
    else if (id === 'queue') {
      const list = player.queue.tracks.map((t, i) => `${i + 1}. **${t.info?.title}**`).join('\n') || 'File vide.';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📋 File d'attente").setDescription(list.slice(0, 4096))], ephemeral: true });
    }
  },

  async handleModal(interaction, client) {
    if (interaction.customId !== 'add_song_modal') return;
    await interaction.deferReply({ ephemeral: true });
    await playQuery(interaction.fields.getTextInputValue('song_query'), interaction, client);
  },
};
