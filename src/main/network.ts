import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import ed from 'bittorrent-dht-sodium';
import DHT from 'bittorrent-dht';
import WebTorrent from 'webtorrent';


const client = new WebTorrent();
const dht = new DHT();
dht.listen(20000, () => {
  console.log(`dht now listening`);
});

async function parseModList(filePath) {
	const file = await fs.readFile(filePath, 'utf-8');
	return file.split('\r\n').filter((filename) => {return filename[0]==='+'}).map((filename) => {return filename.substring(1)}).reverse();
}

async function walkDirectory(directoryPath) {
	if(directoryPath.indexOf('.mohidden')!==-1) {
		return [];
	}
	try {
		let result = [];
		const members = await fs.readdir(directoryPath);
		for(const member of members) {
			const fullPath = path.join(directoryPath,member);
			const stat = await fs.stat(fullPath);
			const isDirectory = stat.isDirectory();
			if(!isDirectory) {
				result.push(fullPath);
			} else {
				let subDirectory = await walkDirectory(fullPath);
				result = result.concat(subDirectory);
			}
		}
		return result;
	} catch(e){
		console.log(e);
		return [];
	}
}

async function walkModList(modList,modsPath) {
	const pathsToWalk = modList.map((modName) => {
		return path.join(modsPath,modName);
	});
	return Promise.all(pathsToWalk.map(walkDirectory));
}

async function getFilesToShare(filePath) {
	const modList = await parseModList(filePath);
	const modsPath = path.join(filePath,'../../../mods');
	const allFiles = await walkModList(modList,modsPath);
	let relativeToFullPath = {};
	let hashToPath = {};
	for(let i=0;i<allFiles.length;i++) {
		const files = allFiles[i];
		const modName = modList[i];
		for(let file of files) {
			let relativePath = path.relative(modsPath,file).substring(modName.length+1); //+1 to also chop off the /
			relativeToFullPath[relativePath] = file;
		}
	}
	for(let file in relativeToFullPath) {
		try {
			const fullPath = relativeToFullPath[file];
			const hash = crypto.createHash('sha256');
			const input = await fs.readFile(fullPath);
			hash.update(input);
			let computedHash = hash.digest('hex');
			relativeToFullPath.hash = computedHash;
			if(!hashToPath[computedHash]){
				hashToPath[computedHash] = [fullPath];
			} else {
				hashToPath[computedHash].push(fullPath);
			}
		} catch(e){
			console.log(e);
		}
	}
	return hashToPath;
}

async function seedFile(filePath) {
	let result = new Promise((resolve,reject) =>{	
		client.seed(filePath, function(torrent) {
			resolve(torrent);
		});
	});
	return result;
}

async function shareModList(filePath) {
	return new Promise(async function(resolve,reject) {
		const hashedMappedFiles = await getFilesToShare(filePath);
		const modsPath = path.join(filePath,'../../../mods');
		console.log("mapped files");
		let infoHashMappedFiles = {};
		for(let hash in hashedMappedFiles) {
			let torrent = await seedFile(hashedMappedFiles[hash],client);
			infoHashMappedFiles[torrent.infoHash] = path.relative(modsPath,hashedMappedFiles[hash]);
		}
		console.log("generated torrents");
		const serialized = JSON.stringify(infoHashMappedFiles);
		//anything over 1000 bytes cannot be stored directly on the DHT
		//make a new torrent and store infohash to that instead
		const keypair = ed.keygen();
		const infoTorrent = await seedFile(Buffer.from(serialized),client);
		const value = Buffer.from(infoTorrent.infoHash);
		const opts = {
			k: keypair.pk,
			seq: 0,
			v: value,
			sign: (buf) => {
				return ed.sign(buf,keypair.sk);
			}
		};
		console.log("generating infodata on dht");
		dht.put(opts, function(err,hash) {
			console.log('done');
			resolve(hash);
		});
	});
}


async function getModListTorrent(infoHash){
	return new Promise(async function(resolve,reject){
			dht.get(infoHash, function(err,res){
				console.log(err);
				if(res===null){
					reject('Mod list not found');
				} else {
					resolve(res.v);
				}
			})
	});
}

async function getModList(infoHash){
	return new Promise(async function(resolve,reject){
			client.add(infoHash, (torrent) => {
				torrent.on('done', () => {
					let file = torrent.files?.[0];
					if(file===undefined){
						reject('Invalid mod list infohash');
					} else {
						file.getBuffer((err,buffer) => {
							try {
								resolve(JSON.parse(buffer.toString()));
							} catch (e){
								reject('Could not parse mod list');
							}
						})
					}
				});
			});
	});
}

async function getMod(infoHash,path){
		client.add(infoHash, {
			'path':path
		}, (torrent) => {
			console.log(torrent);
		});
}

async function downloadModList(filePath,infoHash) {
	console.log(filePath);
	console.log(infoHash);
	return new Promise(async function(resolve,reject){
			try {
				const modListTorrent = await getModListTorrent(infoHash,dht);
				let modList = getModList(modListTorrent,client);
				const existingFiles = await getFilesToShare(filePath);
				const modsPath = path.join(filePath,'../../../mods');

				for(let mod in modList) {
					const targetLocation = path.join(modsPath,modList[mod]);
					//don't download stuff we already have
					if(existingFiles[mod]!==undefined){
						await fs.copyFile(existingFiles[mod],targetLocation);
					} else {					
						getMod(modList[mod],targetLocation,client);
					}
				}
				resolve(true);
			} catch(e){
				reject(e);
			}
	});
}

module.exports = {
	'shareModList' :shareModList,
	'downloadModList':downloadModList
};