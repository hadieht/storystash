const U = globalThis.IGDL;
const $ = (id) => document.getElementById(id);

function renderExample(s) {
  $('example').textContent = U.buildFilename({
    username: 'natgeo', date: new Date(), id: 'C1a2B3c4D5e', index: 1, ext: 'jpg', settings: s
  });
}

function read() {
  return {
    dateSource: $('dateSource').value,
    folder: $('folder').value.trim(),
    perUserFolder: $('perUserFolder').checked,
    useApi: $('useApi').checked
  };
}

async function init() {
  const s = await chrome.storage.local.get(U.DEFAULT_SETTINGS);
  $('dateSource').value = s.dateSource;
  $('folder').value = s.folder;
  $('perUserFolder').checked = !!s.perUserFolder;
  $('useApi').checked = !!s.useApi;
  renderExample(s);

  const save = async () => {
    const v = read();
    await chrome.storage.local.set(v);
    renderExample(v);
    $('status').textContent = 'Saved ✓';
    setTimeout(() => { $('status').textContent = ''; }, 1200);
  };
  ['dateSource', 'perUserFolder', 'useApi'].forEach((id) => $(id).addEventListener('change', save));
  $('folder').addEventListener('input', save);
}

init().catch((e) => { $('status').textContent = 'Error: ' + e.message; });
