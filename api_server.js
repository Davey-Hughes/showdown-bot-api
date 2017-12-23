var net = require('net');
var pack = require('bufferpack');
var PokeClient = require('pokemon-showdown-api').PokeClient;

var websocket = 'ws://localhost:8000/showdown/websocket';
var verification = 'https://play.pokemonshowdown.com/action.php';

function parse_data(data) {
    var lengthbuf = data.slice(0, 4);
    var length = pack.unpack('!I', lengthbuf)[0];
    var payload = data.slice(4, 4 + length).toString('utf-8');
    return JSON.parse(JSON.parse(payload));
}

function send_reply(message, conn) {
    var return_payload = JSON.stringify(message);
    var sendlen = pack.pack('!I', [return_payload.length]);
    conn.write(sendlen);
    conn.write(return_payload);
}

function simple_reply(data, conn) {
    payload = parse_data(data);
    send_reply(payload, conn);
}

function login(payload, conn) {
    client = new PokeClient(websocket, verification);
    client.connect();

    client.on('ready', function() {
        client.login(payload.username);
    });

    client.on('login', function(user) {
        send_reply('success', conn);
        console.log('Logged in as:', user);
        client.send('/join lobby', 'lobby')
        client.send('hello', 'lobby')
    });

    client.on('error:login', function(err) {
        console.log('Error encountered while logging in:', err);
        send_reply('failed', conn);
    });

    conn['pokeClient'] = client;
}

function dispatch(data, conn) {
    payload = parse_data(data);

    if (typeof(payload) != 'object') {
        send_reply('string not handled', conn);
        return;
    }

    switch (payload.command) {
        case 'login':
            login(payload, conn);
            break;
    }
}

var connections = [];

var server = net.createServer();
server.listen(9001, 'localhost', 100);

server.on('connection', function(conn) {
    connections.push(conn);

    conn.on('data', function(data) {
        //simple_reply(data, conn);
        dispatch(data, conn);
    });

    conn.on('close', function(data) {
        connections.splice(connections.indexOf(conn), 1);
    });
});
