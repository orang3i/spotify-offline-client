const { app: electronApp, BrowserWindow } = require('electron'); // Electron modules
const express = require('express'); // Express for backend
const querystring = require('querystring');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ytdl = require('@distube/ytdl-core');
const EventEmitter = require('events');
const cors = require('cors');

// Create Express app
const expressApp = express();
const port = 3000;

// Middleware
expressApp.use(cors());
expressApp.use(express.static(path.join(__dirname, 'app'))); // Serve static files

// Spotify credentials (replace with your own in .env file)
require('dotenv').config();
const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const redirectUri = process.env.REDIRECT_URI;

const stateKey = 'spotify_auth_state';
const progressEmitter = new EventEmitter(); // Track download progress

// Generate random state string for OAuth
const generateRandomString = (length) => {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

// Electron-specific setup
let mainWindow;

electronApp.on('ready', () => {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    // Load the auth.html page served by the Express app
    mainWindow.loadURL(`http://localhost:${port}/html/auth.html`);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
});

electronApp.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electronApp.quit();
    }
});

electronApp.on('activate', () => {
    if (mainWindow === null) {
        mainWindow = createMainWindow();
    }
});

// Spotify Login
expressApp.get('/login', (req, res) => {
    const state = generateRandomString(16);
    const scope = 'playlist-read-private playlist-read-collaborative';

    const authQueryParams = querystring.stringify({
        response_type: 'code',
        client_id: clientId,
        scope: scope,
        redirect_uri: redirectUri,
        state: state,
    });

    res.redirect(`https://accounts.spotify.com/authorize?${authQueryParams}`);
});

// Spotify Callback
expressApp.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;

    if (!state || !code) {
        return res.status(400).send('State mismatch or missing code');
    }

    try {
        const tokenResponse = await axios.post('https://accounts.spotify.com/api/token', querystring.stringify({
            code: code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }), {
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });

        const accessToken = tokenResponse.data.access_token;

        // Redirect to fetch playlists
        res.redirect(`/playlists?access_token=${accessToken}`);
    } catch (err) {
        console.error('Error exchanging code for token:', err.message);
        res.status(500).send('Authentication failed');
    }
});

// Fetch Playlists and Save to JSON
expressApp.get('/playlists', async (req, res) => {
    const accessToken = req.query.access_token;

    if (!accessToken) {
        return res.status(401).send('Access token missing');
    }

    try {
        const playlistsResponse = await axios.get('https://api.spotify.com/v1/me/playlists', {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        const playlists = playlistsResponse.data.items;
        const allTracks = [];

        for (const playlist of playlists) {
            const tracksResponse = await axios.get(playlist.tracks.href, {
                headers: { Authorization: `Bearer ${accessToken}` },
            });

            const tracks = tracksResponse.data.items.map((item) => {
                const track = item.track;
                return {
                    name: track.name,
                    artist: track.artists.map((artist) => artist.name).join(', '),
                    album: track.album.name,
                };
            });

            allTracks.push({ playlist: playlist.name, tracks });
        }

        // Save to playlists.json
        const filePath = path.join(__dirname, 'app', 'playlists.json');
        fs.writeFileSync(filePath, JSON.stringify(allTracks, null, 2));
        console.log(`Playlists saved to ${filePath}`);
        res.redirect('/html/home.html');
    } catch (err) {
        console.error('Error fetching playlists:', err.message);
        res.status(500).send('Failed to fetch playlists');
    }
});

// Download Songs for Selected Playlist
expressApp.post('/start-downloads', (req, res) => {
    const playlistName = decodeURIComponent(req.query.playlist);
    if (!playlistName) {
        return res.status(400).send('Playlist name is required');
    }

    console.log(`Received POST request to download playlist: ${playlistName}`);
    processPlaylists(playlistName);
    res.status(200).send('Download started');
});

// Serve Progress Updates
expressApp.get('/progress-updates', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');

    const sendUpdate = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    progressEmitter.on('update', sendUpdate);

    req.on('close', () => {
        progressEmitter.removeListener('update', sendUpdate);
        res.end();
    });
});

// Start the Express server
expressApp.listen(port, () => {
    console.log(`Express app running at http://localhost:${port}`);
});

// Helper functions for downloading songs and album art
async function processPlaylists(selectedPlaylist) {
    const filePath = path.join(__dirname, 'app', 'playlists.json');
    const outputDir = path.join(__dirname, 'app/songs');
    const albumArtDir = path.join(__dirname, 'app/album-art');

    // Ensure directories exist
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    if (!fs.existsSync(albumArtDir)) {
        fs.mkdirSync(albumArtDir, { recursive: true });
    }

    try {
        const playlistsData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const playlist = playlistsData.find((p) => p.playlist === selectedPlaylist);

        if (!playlist) throw new Error('Playlist not found');

        let completedTracks = 0;
        for (const track of playlist.tracks) {
            // Fetch album art URL
            const albumArtUrl = await fetchAlbumArtUrl(track.name, track.artist);

            // Include albumArtUrl in the song object
            track.albumArtUrl = albumArtUrl;

            // Download the song and album art
            await downloadSong(track, outputDir, albumArtDir);

            completedTracks++;
            const percentage = Math.round((completedTracks / playlist.tracks.length) * 100);
            progressEmitter.emit('update', { playlist: selectedPlaylist, percentage });
        }
    } catch (error) {
        console.error('Error processing playlist:', error.message);
    }
}

async function fetchAlbumArtUrl(trackName, artistName) {
    try {
        const spotifyAccessToken = await refreshSpotifyToken();

        const response = await axios.get('https://api.spotify.com/v1/search', {
            headers: { Authorization: `Bearer ${spotifyAccessToken}` },
            params: {
                q: `${trackName} ${artistName}`,
                type: 'track',
                limit: 1,
            },
        });

        const track = response.data.tracks.items[0];
        if (track && track.album.images.length > 0) {
            return track.album.images[0].url;
        }
        console.warn(`No album art found for: ${trackName} - ${artistName}`);
        return null;
    } catch (error) {
        console.error(`Error fetching album art URL for ${trackName} - ${artistName}:`, error.message);
        return null;
    }
}

async function downloadSong(song, outputDir, albumArtDir) {
    const query = `${song.name} ${song.artist}`;
    console.log(`Searching YouTube for: ${query}`);

    const videoURL = await fetchYouTubeURL(query);
    if (!videoURL) {
        console.error(`Failed to fetch URL for: ${query}`);
        return;
    }

    const sanitizedFileName = song.name.replace(/[^a-zA-Z0-9]/g, '_');
    const audioFileName = `${sanitizedFileName}.webm`;
    const albumArtFileName = `${sanitizedFileName}.jpg`;
    const audioOutputFile = path.join(outputDir, audioFileName);

    try {
        console.log(`Downloading audio for: ${query}`);
        const audioStream = ytdl(videoURL, { filter: 'audioonly', quality: 'highestaudio' });
        const fileStream = fs.createWriteStream(audioOutputFile);
        audioStream.pipe(fileStream);

        if (song.albumArtUrl) {
            const albumArtResponse = await axios.get(song.albumArtUrl, { responseType: 'arraybuffer' });
            fs.writeFileSync(path.join(albumArtDir, albumArtFileName), albumArtResponse.data);
        }

        return new Promise((resolve, reject) => {
            audioStream.on('end', () => resolve());
            audioStream.on('error', (err) => reject(err));
        });
    } catch (error) {
        console.error(`Error processing ${query}:`, error.message);
    }
}

async function fetchYouTubeURL(query) {
    try {
        const response = await axios.get('https://www.youtube.com/results', {
            params: { search_query: query },
        });
        const html = response.data;

        const match = html.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
        return match ? `https://www.youtube.com/watch?v=${match[1]}` : null;
    } catch (error) {
        console.error(`Error fetching YouTube URL for ${query}:`, error.message);
        return null;
    }
}

async function refreshSpotifyToken() {
    try {
        const response = await axios.post('https://accounts.spotify.com/api/token', querystring.stringify({
            grant_type: 'client_credentials',
        }), {
            headers: {
                Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        });
        return response.data.access_token;
    } catch (error) {
        console.error('Error refreshing Spotify token:', error.message);
        throw new Error('Failed to refresh Spotify token');
    }
}
