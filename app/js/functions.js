// Load Playlists in home.html
document.addEventListener("DOMContentLoaded", () => {
  const playlistContainer = document.querySelector(".playlist-grid");

  fetch("../playlists.json")
    .then((response) => response.json())
    .then((playlists) => {
      playlists.forEach((playlist, index) => {
        const playlistCard = document.createElement("div");
        playlistCard.classList.add("playlist-card");

        // Use the first track's album art as the cover
        const firstTrack = playlist.tracks[0];
        const albumArt = firstTrack
          ? `../album-art/${firstTrack.name.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_")}.jpg`
          : "../album-cover/default.jpg";

        playlistCard.innerHTML = `
          <a href="index.html" class="playlist-link" data-index="${index}">
            <img src="${albumArt}" alt="${playlist.playlist}" class="playlist-image">
            <div class="playlist-name">${playlist.playlist}</div>
            <div class="playlist-description">${playlist.tracks.length} tracks</div>
          </a>
        `;

        playlistContainer.appendChild(playlistCard);
      });

      // Attach click event to save playlist data
      document.querySelectorAll(".playlist-link").forEach((link) => {
        link.addEventListener("click", (event) => {
          const index = event.target.closest(".playlist-link").dataset.index;
          localStorage.setItem(
            "selectedPlaylist",
            JSON.stringify(playlists[index].tracks)
          );
        });
      });
    })
    .catch((error) => console.error("Error loading playlists:", error));
});

// Load Selected Playlist in index.html
if (window.location.pathname.endsWith("index.html")) {
  document.addEventListener("DOMContentLoaded", () => {
    const selectedPlaylist = JSON.parse(localStorage.getItem("selectedPlaylist"));

    if (selectedPlaylist) {
      const formattedTracks = selectedPlaylist.map((track) => {
        const normalizedName = track.name.toLowerCase().replace(/[^a-zA-Z0-9]/g, "_");

        return {
          name: track.name,
          artist: track.artist,
          album: track.album,
          url: `../songs/${normalizedName}.webm`,
          cover_art_url: `../album-art/${normalizedName}.jpg`,
        };
      });

      Amplitude.init({
        songs: formattedTracks,
      });
    } else {
      console.error("No playlist data found. Please select a playlist from home.");
    }
  });
}
