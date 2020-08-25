const path = require('path');
const fs = require('fs');
const axios = require('axios')
const util = require('util');
const zlib = require('zlib');
const tar = require('tar-stream');

const putioSyncVersion = '2.0.22'
const putioSyncURL = `https://github.com/putdotio/putio-sync/releases/download/v${putioSyncVersion}/putio-sync_${putioSyncVersion}_macos_x86_64.tar.gz`

async function downloadFileFromTarGZ (url, dest, filename) {
  const writer = fs.createWriteStream(dest)
  const extract = tar.extract();
  let found = false
  extract.on('entry', function(header, stream, cb) {
    if (header.name != filename) {
      cb()
      return
    }
    found = true
    writer.on('finish', cb)
    stream.pipe(writer)
  });
  const response = await axios({url, method: 'GET', responseType: 'stream'})
  response.data.pipe(zlib.createGunzip()).pipe(extract);
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    extract.on('finish', () => {
      if (!found) {
        reject(new Error("file not found in archive"))
      }
    })
  })
}

module.exports = {
  bundleIdentifier: "io.put.sync",
  packagerConfig: {
    icon: path.join("img", "putio-sync"),
    appCategoryType: "public.app-category.productivity",
    extendInfo: {
      LSUIElement: 1
    }
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "putio_sync_desktop"
      }
    },
    {
      name: "@electron-forge/maker-zip",
      platforms: [
        "darwin"
      ]
    },
  ],
  hooks: {
    generateAssets: async () => {
      const mkdir = util.promisify(fs.mkdir)
      await mkdir("bin", {recursive: true});
      const binPath = path.join("bin", "putio-sync")
      await downloadFileFromTarGZ(putioSyncURL, binPath, "putio-sync")
      const chmod = util.promisify(fs.chmod)
      return chmod(binPath, 0o775)
    }
  }
}
