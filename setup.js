const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ytDlpPath = path.join(__dirname, 'yt-dlp');

if (!fs.existsSync(ytDlpPath)) {
  console.log('Téléchargement de yt-dlp...');
  execSync(`curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ${ytDlpPath}`);
  execSync(`chmod +x ${ytDlpPath}`);
  console.log('yt-dlp installé.');
}

module.exports = ytDlpPath;
