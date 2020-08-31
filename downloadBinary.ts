const os = require('os')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const util = require('util')
const zlib = require('zlib')
const tar = require('tar-stream')
const unzipper = require('unzipper')

process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason)
  process.exit(1)
})

async function getLatestBinaryVersion (repo: string): Promise<string> {
  const releasesURL = `https://api.github.com/repos/${repo}/releases`
  console.log(`Getting latest release from: ${releasesURL}`)
  const headers: any = {}
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = 'token ' + process.env.GITHUB_TOKEN
  }
  const response = await axios.get(releasesURL, { headers })
  return response.data[0].tag_name.substr(1)
}

async function downloadFileFromTarGZ (url: string, dest: string, filename: string) {
  const writer = fs.createWriteStream(dest)
  const extract = tar.extract()
  extract.on('entry', function (header: any, stream: any, next: Function) {
    if (header.name !== filename) {
      next()
      return
    }
    writer.on('finish', next)
    stream.pipe(writer)
  })
  const response = await axios({ url, method: 'GET', responseType: 'stream' })
  response.data.pipe(zlib.createGunzip()).pipe(extract)
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    extract.on('finish', reject)
  })
}

async function downloadFileFromZip (url: string, dest: string, filename: string) {
  const writer = fs.createWriteStream(dest)
  const extract = unzipper.Parse()
  extract.on('entry', function (entry: any) {
    if (entry.path !== filename) {
      entry.autodrain()
      return
    }
    writer.on('finish', entry.autodrain)
    entry.pipe(writer)
  })
  const response = await axios({ url, method: 'GET', responseType: 'stream' })
  response.data.pipe(extract)
  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    extract.on('finish', reject)
  })
}

(async () => {
  const mkdir = util.promisify(fs.mkdir)
  const binPath = path.join('static', 'bin')
  await mkdir(binPath, { recursive: true })
  const repo = 'putdotio/putio-sync'
  const version = await getLatestBinaryVersion(repo)
  console.log(`Downloading putio-sync binary version: ${version}`)
  switch (os.platform()) {
    case 'darwin': {
      const url = `https://github.com/${repo}/releases/download/v${version}/putio-sync_${version}_macos_x86_64.tar.gz`
      console.log(`Downloading URL: ${url}`)
      const target = path.join(binPath, 'putio-sync')
      await downloadFileFromTarGZ(url, target, 'putio-sync')
      const chmod = util.promisify(fs.chmod)
      await chmod(target, 0o775)
      break
    }
    case 'win32': {
      const url = `https://github.com/${repo}/releases/download/v${version}/putio-sync_${version}_windows_x86_64.zip`
      console.log(`Downloading URL: ${url}`)
      const target = path.join(binPath, 'putio-sync.exe')
      await downloadFileFromZip(url, target, 'putio-sync.exe')
      break
    }
  }
})()
