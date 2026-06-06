// Télécharge yt-dlp sur Linux si absent
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32') {
  const ytDlpPath = path.join(__dirname, 'yt-dlp');
  if (!fs.existsSync(ytDlpPath)) {
    console.log('📥 Téléchargement de yt-dlp...');
    try {
      execSync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${ytDlpPath} && chmod +x ${ytDlpPath}`);
      console.log('✅ yt-dlp installé.');
    } catch (err) {
      console.error('❌ Impossible de télécharger yt-dlp:', err.message);
    }
  }
}
