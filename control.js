const URL = require('url');
const EventEmitter = require("events");
const axios = require('axios');
const qs = require('querystring')
const WebSocket = require('ws');
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const baseUrl = 'https://192.168.1.1';
const username = 'david';
const password = 'Polgara2';
async function handleMessage(messageContent) {
	
	console.log("Received Message");
	let message = null;
	try {
		message = JSON.parse(messageContent);
		if (!message["export"]) {
			console.log("JSON Message Received but not export " + JSON.stringify(message));
			return;
		}
	} catch (err) {
		console.log("Non JSON Message Received " + messageContent.toString());
		return;
	}
    const time = new Date().toISOString().substring(0, 19).replace('T', ' ');
    const exportItems = message['export'];
    for (const ip in exportItems) {
        const exportItem = exportItems[ip];
        for (const appAndCategory in exportItem) {
            const stat = exportItem[appAndCategory]
            //const hostname = _hostnames[ip] || ip;
            const [appName, categoryName] = appAndCategory.split(/\|/);
			console.log("rec'd messages \t" + appName + "\t" + categoryName + "\t" + JSON.stringify(stat));
        }
    }
}
async function logon(baseUrl, username, password) {
    const form = { username: username, password: password };
    const response = await axios.post(baseUrl, qs.stringify(form), {
        maxRedirects: 0,
        validateStatus: () => true // accept all certs
    });

    if (!response.headers['set-cookie']){
        throw new Error('Logon failed, please check username/password')
    }
    const cookies = response.headers['set-cookie'].reduce((obj, item) => {
        const [name, value] = item.split(/=/);
        obj[name] = value.split(/;/)[0];
        return obj;
    }, {});
    const sessionCookie = cookies['beaker.session.id'];
    return sessionCookie;
}
class EdgeOSServer extends EventEmitter {
	constructor(username,password, refreshPeriod, baseUrl) {
		super();
		this.username = username;
		this.password = password;
		this.refreshPeriod = refreshPeriod || 60;
		this.baseUrl = baseUrl || 'https://192.168.1.1';
		this._devices = {};
		this.sessionCookie = null;
		this.webSocket = {};
		this.messageLength = 0;
		this.messageContent = "";
		this.doOnce = false;
	}
	async init() {
		this.sessionCookie = await this.logon(baseUrl, username, password);
		await this.refreshHostNames();
		//await this.createWS();
	}
	async createWS() {
		const url = URL.parse(this.baseUrl);
		//const wsAddress = ( (url.protocol == 'https:') ? 'wss:' : 'ws:') + "//" + url.hostname + "/ws/stats";
		const wsAddress = ( (url.protocol == 'https:') ? 'wss:' : 'ws:') + "//" + url.hostname + "/ws/cli";
		this.webSocket = new WebSocket(wsAddress, {servername: (((/\d+\.\d+\.\d+\.\d+/).test(url.hostname)) ? '' : undefined) });
		const self = this;
		this.webSocket.on('open', function open(x) {
			console.log("cookie=" + self.sessionCookie + " x=" + x);
			if (wsAddress.includes("/ws/stats")) {
				const initMessage = JSON.stringify({
					SUBSCRIBE: [{ name: "export" },{"name":"system-stats"}],"UNSUBSCRIBE":[],
					SESSION_ID: self.sessionCookie
				});
				console.log("Sending: " + initMessage.length + " mess=" + initMessage);
				this.send(initMessage.length + '\n' + initMessage, function (e) {
					if (e) console.error('init message error', e);
				});
			}
		});
		this.webSocket.on('message', async (data) => {
			if (self.messageLength == 0) {
				const newlinepos = data.indexOf('\n');
				self.messageLength = ~~data.slice(0, newlinepos);
				self.messageContent = data.slice(newlinepos + 1);
			} else {
				self.messageContent += data;
			}
			if (self.messageContent.length < self.messageLength) {
				return;
			}
			if (self.messageContent.includes("login")) {
				console.log("Login recd");
				self.webSocket.send(self.username + "\n", (e) => {if (e) console.error('init (login) message error', e)});
			} else if (self.messageContent.includes("Password")) {
				console.log("Password recd");
				self.webSocket.send(self.password + "\n", (e) => {if (e) console.error('init (password) message error', e)});
			} else if (self.messageContent.includes("david@ubnt:~$")) {
				console.log("Prompt recd doOnce=" + self.doOnce);//
				if (!self.doOnce) {
					self.doOnce = true;
					self.webSocket.send("terminal length 0;show arp" + "\n", (e) => {if (e) console.error('init (arp) message error', e)});
				}
			} else {
				await handleMessage(self.messageContent);
			}
			self.messageLength = 0;
			self.messageContent = "";
		});

		this.webSocket.on('error', (code, reason) => {
			console.error('WS ERROR', { code, reason });
		})
		this.webSocket.on('close', (code, reason) => {
			console.error('WS CLOSE', { code, reason });
		})
	}
	async logon(baseUrl, username, password) {
		const form = { username: username, password: password };
		const response = await axios.post(baseUrl, qs.stringify(form), {
			maxRedirects: 0,
			validateStatus: () => true // accept all certs
		});

		if (!response.headers['set-cookie']){
			throw new Error('Logon failed, please check username/password')
		}
		const cookies = response.headers['set-cookie'].reduce((obj, item) => {
			const [name, value] = item.split(/=/);
			obj[name] = value.split(/;/)[0];
			return obj;
		}, {});
		const sess = cookies['beaker.session.id'];
		return sess;
	}
	async refreshHostNames() {
		let now = new Date(Date.now());
		console.log("[edgeos] [info] Refreshing at " + now.toLocaleDateString() + " " + now.toLocaleTimeString());
		const response = await axios.get(baseUrl.replace(/\/$/, '') + "/api/edge/data.json?data=dhcp_leases", {
			headers: { "Cookie": `beaker.session.id=${this.sessionCookie}` }
		});
		for (const pool in response.data.output['dhcp-server-leases']) {
			const leases = response.data.output['dhcp-server-leases'][pool]; //DHC
			for (const ip in leases) {
				if (!this._devices[leases[ip]['mac']]) {
					console.log("[edgeos] [info] New Device [" + leases[ip]['mac'] + "] [" + ip + "] [" + leases[ip]['client-hostname'] + "] ");
					this._devices[leases[ip]['mac']] = {"ip": ip, "hostname": leases[ip]['client-hostname']}
				} else {
					if (this._devices[leases[ip]['mac']].ip != ip) {
						console.log("[edgeos] [info] IP Changed [" + leases[ip]['mac'] +
							"] [" + ip + "] [" + leases[ip]['client-hostname'] + "] old IP=" + this._devices[leases[ip]['mac']].ip);
					}
					if (this._devices[leases[ip]['mac']].hostname != leases[ip]['client-hostname']) {
						console.log("[edgeos] [info] IP Changed [" + leases[ip]['mac'] +
							"] [" + ip + "] [" + leases[ip]['client-hostname'] + "] old hostname=" + this._devices[leases[ip]['mac']].hostname);
					}
				}
				//console.log("ip is " + ip + " entry is " + leases[ip]['client-hostname'] + " " + leases[ip]['mac'])
			}
		}
	}
}
const serv = new EdgeOSServer('david', 'Polgara2');
serv.init().then(() => {
		serv.createWS().then( () => {
			setInterval( () => { serv.refreshHostNames()} , serv.refreshPeriod * 1000 );
		});
	});
