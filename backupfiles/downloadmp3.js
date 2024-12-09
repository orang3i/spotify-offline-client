const fs = require('fs');
const path = require('path');
const ytdl = require('@distube/ytdl-core');
const { spawn } = require('child_process');
const ffmpeg = require('ffmpeg-static');
const axios = require('axios');

// Paths
const playlistFile = path.join(__dirname, '../playlists.json');
const outputDir = path.join(__dirname, 'songs');

// Ensure the output directory exists
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

// Function to search YouTube for a song and return the video URL
async function fetchYouTubeURL(query) {
    try {
        const response = await axios.get('https://www.youtube.com/results', {
            params: { search_query: query },
        });
        const html = response.data;

        // Extract the first video URL
        const match = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
        if (match && match[1]) {
            return `https://www.youtube.com/watch?v=${match[1]}`;
        }
        throw new Error(`No results found for query: ${query}`);
    } catch (error) {
        console.error(`Error fetching YouTube URL for ${query}:`, error.message);
        return null;
    }
}

// Function to download and convert a song to MP3
async function downloadAndConvert(song, outputDir) {
    const query = `${song.name} ${song.artist}`;
    console.log(`Searching YouTube for: ${query}`);

    const videoURL = await fetchYouTubeURL(query);
    if (!videoURL) {
        console.error(`Failed to fetch URL for: ${query}`);
        return;
    }

    const fileName = `${song.name.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`;
    const tempFile = path.join(outputDir, `${fileName}.webm`);
    const outputFile = path.join(outputDir, fileName);

    try {
        console.log(`Downloading audio for: ${query}`);
        const audioStream = ytdl(videoURL, { filter: 'audioonly', quality: 'highestaudio' });
        const fileStream = fs.createWriteStream(tempFile);

        audioStream.pipe(fileStream);

        return new Promise((resolve, reject) => {
            audioStream.on('end', () => {
                console.log(`Audio downloaded. Converting ${fileName} to MP3...`);
                const ffmpegProcess = spawn(ffmpeg, [
                    '-i', tempFile,
                    '-vn',
                    '-ar', '44100',
                    '-ac', '2',
                    '-b:a', '192k',
                    '-f', 'mp3',
                    outputFile,
                ]);

                ffmpegProcess.on('close', (code) => {
                    if (code === 0) {
                        console.log(`MP3 saved as ${outputFile}`);
                        fs.unlinkSync(tempFile); // Clean up temp file
                        resolve();
                    } else {
                        console.error(`Error converting ${fileName}`);
                        reject(new Error('Conversion failed'));
                    }
                });

                ffmpegProcess.on('error', (err) => {
                    console.error(`Error during conversion of ${fileName}:`, err.message);
                    reject(err);
                });
            });

            audioStream.on('error', (err) => {
                console.error(`Error during download of ${fileName}:`, err.message);
                reject(err);
            });
        });
    } catch (error) {
        console.error(`Error processing ${query}:`, error.message);
    }
}

// Function to process all playlists and download songs
async function processPlaylists() {
    try {
        const playlistsData = JSON.parse(fs.readFileSync(playlistFile, 'utf8'));

        for (const playlist of playlistsData) {
            console.log(`Processing playlist: ${playlist.playlist}`);
            for (const track of playlist.tracks) {
                await downloadAndConvert(track, outputDir);
            }
        }

        console.log('All songs downloaded successfully!');
    } catch (error) {
        console.error('Error processing playlists:', error.message);
    }
}

// Start processing
processPlaylists();
