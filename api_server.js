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

    conn.challenges = {};
    conn.challenge_errors = [];
    conn.battles = [];

    client.on('ready', function() {
        client.login(payload.username);
    });

    client.on('login', function(user) {
        send_reply('success', conn);
        console.log('Logged in as:', user);
    });

    client.on('error:login', function(err) {
        console.log('Error encountered while logging in:', err);
        send_reply('failed', conn);
    });

    client.on('chat:private', function(message) {
        if ('data' in message && 'message' in message.data) {
            if (message.data.message.search('/error') != -1 &&
                message.data.message.search('not found') != -1) {
                conn.challenge_errors.push(message.data.message);
            }
        }
    });

    client.on('info:popup', function(message) {
        if (message.data.search('You are already challenging') != -1 ||
            message.data.search('You challenged less than 10' != -1)) {
            conn.challenge_errors.push(message.data);
        }
    });

    client.on('self:challenges', function(message) {
        conn.challenges = message.data;
    });

    client.on('room:title', function(message) {
        if (message.room.search('battle') != -1) {
            conn.battles.push(message);
        }
    });

    client.on('message', function(message) {
        // console.log(message);
    });

    conn['pokeClient'] = client;
}

function logout(payload, conn) {
    client = conn.pokeClient;
    room = 'lobby';
    if ('room' in payload) {
        room = payload.room;
    }

    client.send('/logout', room)
    send_reply('success', conn);
}

function send_challenge(payload, conn) {
    client = conn.pokeClient;
    msg = '/pm ' + payload.user + ', /challenge ' +
          payload.user + ', ' + payload.format;
    client.send(msg, 'global');
    send_reply('sent', conn);
}

function get_challenges(conn) {
    send_reply(conn.challenges, conn);
    send_reply(conn.challenge_errors, conn);
    conn.challenge_errors = []
}

function get_battles(conn) {
    send_reply(conn.battles, conn);
}

function send_default(payload, conn) {
    client = conn.pokeClient;
    room = 'lobby';
    if ('room' in payload) {
        room = payload.room;
    }

    client.send(payload.showdown_cmd, room);
    send_reply('success', conn);
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
        case 'logout':
            logout(payload, conn);
            break;
        case 'send_challenge':
            send_challenge(payload, conn);
            break;
        case 'get_challenges':
            get_challenges(conn);
            break;
        case 'get_battles':
            get_battles(conn);
            break;
        case 'send_default':
            send_default(payload, conn);
            break;
        default:
            console.log('Case not handled:' + payload.command);
            send_reply('error', conn);
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
