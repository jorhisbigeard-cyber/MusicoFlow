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
const { spawn, execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const ytDlpPath = require('../setup');

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

  let cleanQuery = query;
  if (isUrl) {
    try {
      const u = new URL(query);
      if (u.hostname.includes('youtube.com')) {
        const v = u.searchParams.get('v');
        if (v) cleanQuery = `https://www.youtube.com/watch?v=${v}`;
      } else if (u.hostname === 'youtu.be') {
        cleanQuery = `https://youtu.be${u.pathname}`;
      }
    } catch {}
  }

  const searchQuery = isUrl ? cleanQuery : `ytsearch1:${cleanQuery}`;
  const cookiesPath = require('path').join(__dirname, '..', 'cookies.txt');
  const fs = require('fs');
  const cookiesArgs = fs.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];

  const info = await new Promise((resolve, reject) => {
    execFile(ytDlpPath, [
      searchQuery,
      '--dump-single-json',
      '--no-warnings',
      '--no-playlist',
      '-f', 'bestaudio/best',
      ...cookiesArgs,
    ], (err, stdout) => {
      if (err) return reject(err);
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(e); }
    });
  });

  const entry = info.entries ? info.entries[0] : info;
  return {
    title: entry.title,
    url: entry.webpage_url || entry.original_url || entry.url,
    audioUrl: entry.url,
    duration: entry.duration_string || '??:??',
    thumbnail: entry.thumbnail || '',
  };
}

function createStream(audioUrl) {
  const cookiesPath = require('path').join(__dirname, '..', 'cookies.txt');
  const fs = require('fs');
  const cookiesArgs = fs.existsSync(cookiesPath) ? ['--cookies', cookiesPath] : [];

  const ffmpeg = spawn(ffmpegPath, [
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '5',
    '-i', audioUrl,
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  ffmpeg.stderr.on('data', () => {});
  ffmpeg.on('error', err => console.error('ffmpeg:', err));
  return ffmpeg.stdout;
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
    const { stream, type } = await createStream(song.audioUrl || song.url);
    const resource = createAudioResource(stream, { inputType: StreamType.Raw });

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
