const express = require('express');
const querystring = require('querystring');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const port = 3000;

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const redirectUri = process.env.REDIRECT_URI;

const stateKey = 'spotify_auth_state';

// Generate a random state string for security
const generateRandomString = (length) => {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

// Login route to start Spotify OAuth flow
app.get('/login', (req, res) => {
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

// Callback route for Spotify authentication
app.get('/callback', async (req, res) => {
    const code = req.query.code || null;
    const state = req.query.state || null;

    if (!state || !code) {
        return res.status(400).send('State mismatch or missing code');
    }

    try {
        // Exchange the authorization code for an access token
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

// Fetch all playlists and their tracks, and save to a JSON file with album art
app.get('/playlists', async (req, res) => {
    const accessToken = req.query.access_token;

    if (!accessToken) {
        return res.status(401).send('Access token missing');
    }

    try {
        const playlistsResponse = await axios.get('https://api.spotify.com/v1/me/playlists', {
            headers: {
                Authorization: `Bearer ${accessToken}`,
            },
        });

        const playlists = playlistsResponse.data.items;

        const allTracks = [];
        const albumArtDir = path.join(__dirname, 'album-art');

        // Ensure album art directory exists
        if (!fs.existsSync(albumArtDir)) {
            fs.mkdirSync(albumArtDir, { recursive: true });
        }

        for (const playlist of playlists) {
            const tracksResponse = await axios.get(playlist.tracks.href, {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            });

            const tracks = await Promise.all(
                tracksResponse.data.items.map(async (item) => {
                    const track = item.track;
                    const albumArtUrl = track.album.images[0]?.url; // Get the first image (largest)

                    let albumArtPath = null;
                    if (albumArtUrl) {
                        // Download album art
                        const response = await axios.get(albumArtUrl, { responseType: 'arraybuffer' });
                        const fileName = `${track.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}.jpg`;
                        albumArtPath = path.join(albumArtDir, fileName);
                        fs.writeFileSync(albumArtPath, response.data);
                    }

                    return {
                        name: track.name,
                        artist: track.artists.map((artist) => artist.name).join(', '),
                        album: track.album.name,
                        albumArtPath: albumArtPath ? albumArtPath.replace(__dirname, '') : null,
                    };
                })
            );

            allTracks.push({
                playlist: playlist.name,
                tracks: tracks,
            });
        }

        // Save the playlists and tracks to a JSON file
        const filePath = path.join(__dirname, '../playlists.json');
        fs.writeFileSync(filePath, JSON.stringify(allTracks, null, 2), 'utf8');
        console.log(`Playlists and tracks saved to ${filePath}`);

        // Respond to the client
        app.use(express.static(path.join(__dirname, '..')));
        res.redirect('../home.html');
    } catch (err) {
        console.error('Error fetching playlists or tracks:', err.message);
        res.status(500).send('Failed to fetch playlists or tracks');
    }
});

app.post('/start-downloads', (req, res) => {
    processPlaylists(); // Start processing playlists
    res.status(200).send('Download started');
  });
  
  app.get('/progress-updates', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
  
    const sendUpdate = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
  
    progressEmitter.on('update', sendUpdate);
  
    req.on('close', () => {
      progressEmitter.removeListener('update', sendUpdate);
      res.end();
    });
  });

// Start the server
app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});
