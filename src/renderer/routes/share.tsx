import { Link, useLocation } from "react-router-dom";
import React, { useState } from 'react';

export default function Share() {
	const [modListPath, setModListPath] = useState('');
	const [loading, setLoading] = useState(0);
	const [infoHash, setInfoHash] = useState(0);
	window.electron.ipcRenderer.once('select-file', (filePath) => setPath(filePath));		
	window.electron.ipcRenderer.once('share', (result) => {
		if(result) {		
			setInfoHash(result);
			setLoading(2);
		} else {
			setLoading(0);
		}
	});
	const setPath = function setPath(newPath) {
		setModListPath(newPath);
	}
	
	const selectFile = function selectFile() {
		window.electron.ipcRenderer.sendMessage('select-file');
	}

	const shareModList = function shareModList() {
		window.electron.ipcRenderer.sendMessage('share',modListPath);
		setLoading(1);
	}
	if(loading===0) {	
		return (
			<div>
				<label htmlFor="modListPath">Please select your MO2 modlist.txt.</label>
	            <br/>
	            {modListPath}
				<button type="button" onClick={selectFile}>Browse</button>
	            <br/>
				<button type="button"><Link key="main" to="/">Back</Link></button>
		        <button type="submit" onClick={shareModList}>Submit</button>
		    </div>
		);
	} else if(loading===1) {
		return (
			<div>
				<p>Loading please wait...</p>
			</div>
		);
	} else if(loading===2){
		return (
			<div>
				<p>Ready to share!</p>
				<p>Your infohash is: {infoHash}</p>
				<button type="button"><Link key="main" to="/">Back</Link></button>
			</div>
		);
	}

};