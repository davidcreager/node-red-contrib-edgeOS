const EdgeOSServer = require("./edgeOSServer.js");
const serv = new EdgeOSServer('david', 'Polgara2');
serv.on("", (devices) => {
	console.log("received event " + devices.type + " - \t[" + devices.mac + "][" + devices.ip + "]\t" + devices.hostname);
	
});
serv.init().then(() => {
		serv.createWS().then( () => {
			setInterval( () => { serv.refreshHostNames()} , serv.refreshPeriod * 1000 );
		});
	});
