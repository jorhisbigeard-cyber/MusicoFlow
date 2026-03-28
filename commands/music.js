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
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require('@discordjs/voice');
const play = require('play-dl');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');

const queues = new Map();

function buildEmbed(song, isPaused = false) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(isPaused ? '⏸️ En pause' : '🎵 En cours de lecture')
    .setDescription(`**[${song.title}](${song.url})**`)
    .setThumbnail(song.thumbnail)
    .addFields({ name: 'Durée', value: song.duration, inline: true });
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

async function getSongData(query) {
  const isUrl = /^https?:\/\//.test(query);

  let videoUrl;
  let title, duration, thumbnail;

  if (isUrl) {
    // Nettoyer les paramètres de playlist
    try {
      const u = new URL(query);
      if (u.hostname.includes('youtube.com')) {
        const v = u.searchParams.get('v');
        if (v) videoUrl = `https://www.youtube.com/watch?v=${v}`;
        else videoUrl = query;
      } else if (u.hostname === 'youtu.be') {
        videoUrl = `https://youtu.be${u.pathname}`;
      } else {
        videoUrl = query;
      }
    } catch { videoUrl = query; }

    const info = await play.video_info(videoUrl);
    title = info.video_details.title;
    duration = info.video_details.durationRaw;
    thumbnail = info.video_details.thumbnails?.at(-1)?.url || '';
  } else {
    const results = await play.search(query, { limit: 1 });
    if (!results.length) throw new Error('Aucun résultat');
    videoUrl = results[0].url;
    title = results[0].title;
    duration = results[0].durationRaw;
    thumbnail = results[0].thumbnails?.at(-1)?.url || '';
  }

  return { title, url: videoUrl, duration, thumbnail };
}

async function createStream(url) {
  const stream = await play.stream(url);
  return { stream: stream.stream, type: stream.type };
}

async function playNext(guildId, textChannel) {
  const queue = queues.get(guildId);
  if (!queue || queue.songs.length === 0) {
    queue?.connection?.destroy();
    queues.delete(guildId);
    if (queue?.panelMessage) {
      queue.panelMessage.edit({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('⏹️ File terminée').setDescription('Plus aucune musique.')],
        components: [],
      }).catch(() => {});
    }
    return;
  }

  const song = queue.songs[0];

  try {
    const { stream, type } = await createStream(song.url);
    const resource = createAudioResource(stream, { inputType: type });

    queue.player.play(resource);
    queue.isPaused = false;

    if (queue.panelMessage) {
      queue.panelMessage.edit({
        embeds: [buildEmbed(song, false)],
        components: [buildButtons(false)],
      }).catch(() => {});
    }

    queue.player.once(AudioPlayerStatus.Idle, () => {
      queue.songs.shift();
      playNext(guildId, textChannel);
    });

    queue.player.on('error', err => {
      console.error('Player error:', err);
      queue.songs.shift();
      playNext(guildId, textChannel);
    });

  } catch (err) {
    console.error(err);
    textChannel.send('❌ Impossible de lire cette musique.');
    queue.songs.shift();
    playNext(guildId, textChannel);
  }
}

async function addToQueue(guildId, voiceChannel, guild, channel, songData) {
  let queue = queues.get(guildId);

  if (!queue) {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: guild.voiceAdapterCreator,
    });
    const player = createAudioPlayer();
    connection.subscribe(player);
    queue = { connection, player, songs: [], panelMessage: null, isPaused: false };
    queues.set(guildId, queue);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
    } catch {
      queues.delete(guildId);
      throw new Error('Impossible de rejoindre le salon vocal.');
    }
  }

  queue.songs.push(songData);
  return queue;
}

module.exports = {
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

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const member = interaction.member;
    const voiceChannel = member.voice.channel;
    const guildId = interaction.guildId;

    if (sub === 'play') {
      if (!voiceChannel)
        return interaction.reply({ content: '❌ Tu dois être dans un salon vocal.', ephemeral: true });

      await interaction.deferReply();
      const query = interaction.options.getString('query');

      let songData;
      try {
        songData = await getSongData(query);
      } catch (err) {
        console.error(err);
        return interaction.editReply('❌ Impossible de trouver cette musique.');
      }

      let queue;
      try {
        queue = await addToQueue(guildId, voiceChannel, interaction.guild, interaction.channel, songData);
      } catch (err) {
        return interaction.editReply(`❌ ${err.message}`);
      }

      if (queue.player.state.status === AudioPlayerStatus.Idle) {
        const msg = await interaction.editReply({
          embeds: [buildEmbed(songData)],
          components: [buildButtons()],
        });
        queue.panelMessage = msg;
        playNext(guildId, interaction.channel);
      } else {
        await interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('➕ Ajouté à la file')
            .setDescription(`**[${songData.title}](${songData.url})**`)
            .addFields({ name: 'Position', value: `${queue.songs.length}`, inline: true })],
        });
      }
    }

    else if (sub === 'queue') {
      const queue = queues.get(guildId);
      if (!queue || !queue.songs.length)
        return interaction.reply({ content: '📭 La file est vide.', ephemeral: true });

      const list = queue.songs.map((s, i) => `${i === 0 ? '▶️' : `${i}.`} **${s.title}** (${s.duration})`).join('\n');
      interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📋 File d'attente").setDescription(list.slice(0, 4096))],
        ephemeral: true,
      });
    }
  },

  async handleButton(interaction) {
    const guildId = interaction.guildId;
    const queue = queues.get(guildId);
    const id = interaction.customId;

    if (id === 'add_song') {
      const modal = new ModalBuilder()
        .setCustomId('add_song_modal')
        .setTitle('Ajouter une musique');
      const input = new TextInputBuilder()
        .setCustomId('song_query')
        .setLabel('Nom ou URL YouTube')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Ex: Never Gonna Give You Up')
        .setRequired(true);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      return await interaction.showModal(modal);
    }

    if (!interaction.member.voice.channel)
      return interaction.reply({ content: '❌ Tu dois être dans un salon vocal.', ephemeral: true });
    if (!queue)
      return interaction.reply({ content: '❌ Aucune musique en cours.', ephemeral: true });

    if (id === 'pause_resume') {
      queue.isPaused ? queue.player.unpause() : queue.player.pause();
      queue.isPaused = !queue.isPaused;
      await interaction.update({ embeds: [buildEmbed(queue.songs[0], queue.isPaused)], components: [buildButtons(queue.isPaused)] });
    }
    else if (id === 'skip') {
      queue.player.stop();
      await interaction.reply({ content: '⏭️ Musique passée.', ephemeral: true });
    }
    else if (id === 'stop') {
      queue.songs = [];
      queue.player.stop();
      queue.connection.destroy();
      queues.delete(guildId);
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('⏹️ Arrêté').setDescription('File vidée.')],
        components: [],
      });
    }
    else if (id === 'queue') {
      const list = queue.songs.map((s, i) => `${i === 0 ? '▶️' : `${i}.`} **${s.title}** (${s.duration})`).join('\n') || 'File vide.';
      await interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle("📋 File d'attente").setDescription(list.slice(0, 4096))],
        ephemeral: true,
      });
    }
  },

  async handleModal(interaction) {
    if (interaction.customId !== 'add_song_modal') return;

    const guildId = interaction.guildId;
    const query = interaction.fields.getTextInputValue('song_query');
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel)
      return interaction.reply({ content: '❌ Tu dois être dans un salon vocal.', ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    let songData;
    try {
      songData = await getSongData(query);
    } catch (err) {
      console.error(err);
      return interaction.editReply('❌ Impossible de trouver cette musique.');
    }

    let queue;
    try {
      queue = await addToQueue(guildId, voiceChannel, interaction.guild, interaction.channel, songData);
    } catch (err) {
      return interaction.editReply(`❌ ${err.message}`);
    }

    if (queue.player.state.status === AudioPlayerStatus.Idle) {
      playNext(guildId, interaction.channel);
      await interaction.editReply(`✅ Lecture de **${songData.title}**`);
    } else {
      await interaction.editReply(`➕ **${songData.title}** ajouté en position ${queue.songs.length}`);
    }
  },
};
