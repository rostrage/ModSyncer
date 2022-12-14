import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import ed from 'bittorrent-dht-sodium';
import DHT from 'bittorrent-dht';
import WebTorrent from 'webtorrent';


const client = new WebTorrent();
client.on('error', function (err) {
	console.log(err);
	console.log('error with torrent');
})
const dht = new DHT({
	'bootstrap' : [
	'192.168.1.251:6881'
	],
  'verify': ed.verify,
});
dht.listen(6881,() => {
	//add ourself in case we aren't currently connected to any other nodes.
  dht.addNode({ host: '127.0.0.1', port: dht.address().port })
  console.log(`dht now listening`);
});
dht.on('node', (node) =>{
	console.log('new node');
	console.log(node);
})
dht.on('peer', (peer,infoHash,from) => {
	console.log('new peer');
})
dht.on('warning', function (err) {
	console.log('dht warning');
	console.log(err);
})
dht.on('error', function (err) {
	console.log('dht error');
	console.log(err);
})
dht.on('ready', function () {
	console.log('dht ready');
})
async function parseModList(filePath) {
	try {
		const file = await fs.readFile(filePath, 'utf-8');
		return file.split('\r\n').filter((filename) => {return filename[0]==='+'}).map((filename) => {return filename.substring(1)}).reverse();		
	} catch(e){
		throw 'Could not parse mod list';
	}
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
	try{	
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
	} catch (e) {
		throw e;
	}
}

async function seedFile(file) {
	let result = new Promise((resolve,reject) =>{	
		client.seed(file, function(torrent) {
			resolve(torrent);
		});
	});
	return result;
}

async function shareModList(filePath) {
	return new Promise(async function(resolve,reject) {
		try {		
			const hashedMappedFiles = await getFilesToShare(filePath);
			const modsPath = path.join(filePath,'../../../mods');
			console.log("mapped files");
			let infoHashMappedFiles = {};
			for(const hash in hashedMappedFiles) {
				const buffer = await fs.readFile(hashedMappedFiles[hash][0]);
				buffer.name = path.basename(hashedMappedFiles[hash][0])
				const torrent = await seedFile(buffer);
				const relativePaths = hashedMappedFiles[hash].map((fullPath) => path.relative(modsPath,fullPath));
				infoHashMappedFiles[torrent.magnetURI] = relativePaths;
			}
			console.log("generated torrents");
			const serialized = JSON.stringify(infoHashMappedFiles);
			//anything over 1000 bytes cannot be stored directly on the DHT
			//make a new torrent and store infohash to that instead
			const keypair = ed.keygen();
			const infoBuffer = Buffer.from(serialized);
			infoBuffer.name = 'info.json'
			const infoTorrent = await seedFile(infoBuffer,client);
			console.log(infoTorrent.magnetURI);
			const value = Buffer.from(infoTorrent.magnetURI);
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
				console.log(err);
				console.log('done');
				resolve(hash);
			});
		} catch(e) {
			reject(e);
		}
	});
}


async function getModListTorrent(infoHash){
	return new Promise(async function(resolve,reject){
		dht.lookup(infoHash, () =>{
			dht.get(infoHash, function(err,res){
				console.log(err);
				if(res===null){
					reject('Mod list not found');
				} else {
					resolve(res.v);
				}
			})			
		})
	});
}

async function getModList(infoHash){
	return new Promise(async function(resolve,reject){
			client.add(infoHash.toString(), (torrent) => {
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

async function getMod(infoHash,filePath){
		console.log(`getting mod ${infoHash} ${filePath}`);
		client.add(infoHash, (torrent) => {
			torrent.on('done', () => {
				let file = torrent.files?.[0];
				if(file===undefined) {
					console.log('empty torrent');
				} else {
					console.log(file);
					file.getBuffer((err,buff) => {
						fs.writeFile(filePath,buff);
					})
				}
			})
			console.log(torrent);
		});
}

async function downloadModList(filePath,infoHash) {
	console.log(dht.toJSON());
	return new Promise(async function(resolve,reject){
			try {
				const modListTorrent = await getModListTorrent(infoHash);
				console.log(`got mod list torrent infoHash ${modListTorrent}`);
				let modList = await getModList(modListTorrent);
				const existingFiles = await getFilesToShare(filePath);
				const modsPath = path.join(filePath,'../../../mods');

				for(let mod in modList) {
					console.log(`download mod ${mod}`);
					const targetLocation = path.join(modsPath,modList[mod][0]);
					//don't download stuff we already have
					if(existingFiles[mod]!==undefined){
						await fs.copyFile(existingFiles[mod],targetLocation);
					} else {					
						getMod(mod,targetLocation,client);
					}
				}
				resolve(true);
			} catch(e){
				console.log(e);
				reject(e);
			}
	});
}

module.exports = {
	'shareModList' :shareModList,
	'downloadModList':downloadModList
};