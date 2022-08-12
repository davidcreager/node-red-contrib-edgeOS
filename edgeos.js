module.exports = function(RED) {
    function edgeOSNode(config) {
        RED.nodes.createNode(this,config);
        var node = this;
		this.on('close', function(removed, done) {
			if (timer) {
				console.log("[edgeOSNode] Clearing Timer")
				clearTimeout(timer);
			}
			if (removed) {			
				if (serv) {
					console.log("[edgeOSNode] Closing EdgeOSServer")
					serv.close()
						.then( () => {
							console.log("[edgeOSNode] EdgeOSServer closed");
							done();
						})
						.catch( er => {
							node.error("[" + node.name + "][serv.close Error Caught]" + er);
						} );
				} else {
					console.log("[edgeOSNode] EdgeOSServer does not exist so no need to close")
					done();
				}
			} else {
				console.log("[edgeOSNode]  Node restarted so no need to close EdgeOSServer")
				// This node is being restarted
				done();
			}
		});
		node.warn("[edgeOSNode] command=" + config.command + " name=" + config.name);
		const EdgeOSServer = require("./edgeOSServer.js");
		this.serv = new EdgeOSServer({username:'david', password:'Polgara2',refreshPeriod:30});
		var timer;
		this.serv.init()
			.then(() => {
				console.log("[edgeOSNode] PID is " + node.serv.pid + " this pid is " + process.pid);
				timer = setInterval( () => { node.serv.refreshHostNames()} , node.serv.refreshPeriod * 1000 );
				})
			.catch( er => {
				node.error("[" + node.name + "][init Error Caught]" + er);
			} );
		this.serv.on("devices", (data) => {
			//node.warn("Received ",data);
			node.send({topic: "edgeOS ", payload: data});
		})
        node.on('input', function(msg) {
			if (msg.topic == "refreshHostNames") {
				node.send(msg);
			} else if (msg.topic == "listDevices") {
				node.send({topic:msg.topic, payload:this.serv.listDevices()});
			} else {
				node.send(msg);
			}
        });
    }
    RED.nodes.registerType("edgeos",edgeOSNode);
}