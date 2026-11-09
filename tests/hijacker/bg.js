// Test-only: behaves like download-manager extensions that rename every download.
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  suggest({ filename: 'HIJACKED_' + item.id + '.bin' });
});
