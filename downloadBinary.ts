const path = require('path')
const fs = require('fs')
const axios = require('axios')
const util = require('util')
const zlib = require('zlib')
const tar = require('tar-stream')

async function getLatestBinaryVersion (repo: string): Promise<string> {
  const releasesURL = `https://api.github.com/repos/${repo}/releases`
  const response = await axios.get(releasesURL)
  return response.data[0].tag_name.substr(1)
}

async function downloadFileFromTarGZ (url: string, dest: string, filename: string) {
  const writer = fs.createWriteStream(dest)
  const extract = tar.extract()
  let found = false
  extract.on('entry', function (header: any, stream: any, next: Function) {
    if (header.name !== filename) {
      next()
      return
    }
    found = true
    writer.on('finish', next)
    stream.pipe(writer)
  })
  const response = await axios({ url, method: 'GET', responseType: 'stream' })
  response.data.pipe(zlib.createGunzip()).pipe(extract)
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    extract.on('finish', () => {
      if (!found) {
        reject(new Error('file not found in archive'))
      }
    })
  })
}

(async () => {
  const mkdir = util.promisify(fs.mkdir)
  await mkdir(path.join('static', 'bin'), { recursive: true })
  const binPath = path.join('static', 'bin', 'putio-sync')
  const binaryRepo = 'putdotio/putio-sync'
  const putioSyncVersion = await getLatestBinaryVersion(binaryRepo)
  const putioSyncURL = `https://github.com/putdotio/putio-sync/releases/download/v${putioSyncVersion}/putio-sync_${putioSyncVersion}_macos_x86_64.tar.gz`
  await downloadFileFromTarGZ(putioSyncURL, binPath, 'putio-sync')
  const chmod = util.promisify(fs.chmod)
  await chmod(binPath, 0o775)
})()
