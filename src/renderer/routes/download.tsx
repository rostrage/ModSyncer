import { Link, useLocation } from "react-router-dom";
import React, { useState } from 'react';

export default function Download() {
	const [modListPath, setModListPath] = useState('');
	const [infoHash, setInfoHash] = useState('');
	window.electron.ipcRenderer.once('select-file', (filePath) => setModListPath(filePath));		
	const selectFile = function selectFile() {
		window.electron.ipcRenderer.sendMessage('select-file');
	}

	const downloadModList = function downloadModList(){
		window.electron.ipcRenderer.sendMessage('download',[modListPath,infoHash]);
	}

	const handleChange = function handleChange(e) {
		setInfoHash(e.target.value);
	}

	return (
		<div>
			<label htmlFor="modListPath">Please select your MO2 modlist.txt that you want to sync.</label>
            <br/>
			{modListPath}<button type="button" onClick={selectFile}>Browse</button>
            <br/>
            <label htmlFor="infoHash">Please enter the share infohash.</label>
            <input type="text" id="infoHash" value={infoHash} onChange={handleChange}/>
            <br/>
	        <button type="submit" onClick={downloadModList}>Submit</button>
	    </div>
	);
};
