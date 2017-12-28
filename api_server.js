var net = require('net');
var open = require('open');
var pack = require('bufferpack');
var utf8 = require('utf8');
var PokeClient = require('pokemon-showdown-api').PokeClient;

var base_url = 'http://localhost.psim.us/'
var websocket = 'ws://localhost:8000/showdown/websocket';
var verification = 'https://play.pokemonshowdown.com/action.php';

var login_connections = [];
var action_list = [];

var battle_msgs = PokeClient.MESSAGE_TYPES.BATTLE
var action_msgs = battle_msgs.ACTIONS;

Object.keys(battle_msgs).forEach(function(key, index) {
    if (key != 'ACTIONS' && key != 'REQUEST') {
        action_list.push(battle_msgs[key]);
    }
});

Object.keys(action_msgs.MAJOR).forEach(function(key, index) {
    action_list.push(action_msgs.MAJOR[key]);
});

Object.keys(action_msgs.MINOR).forEach(function(key, index) {
    action_list.push(action_msgs.MINOR[key]);
});

function parse_data(data) {
    var lengthbuf = data.slice(0, 4);
    var length = pack.unpack('!I', lengthbuf)[0];
    var payload = data.slice(4, 4 + length).toString('utf-8');
    return JSON.parse(JSON.parse(payload));
}

function send_reply(message, conn) {
    var return_payload = JSON.stringify(message);
    var utf_8_len = utf8.encode(return_payload).length;
    var sendlen = pack.pack('!I', [utf_8_len]);

    try {
        conn.write(sendlen, 'utf-8');
        conn.write(return_payload, 'utf-8');
    } catch (e) {
    }
}

function simple_reply(data, conn) {
    payload = parse_data(data);
    send_reply(payload, conn);
}

function login(payload, conn) {
    client = new PokeClient(websocket, verification);
    conn.client = client;
    client.connect();

    conn.username = payload.username;
    conn.challenges = {};
    conn.challenge_errors = [];
    conn.battles_pending = [];
    conn.battle_conns = [];

    login_connections.push(conn);

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
            message['chat'] = [];
            message['myteam'] = {};
            message['actions'] = [];
            message.actions.push([]);
            message.turn = 0;
            console.log(conn.battles_pending);
            conn.battles_pending.push(message);
            console.log(conn.battles_pending);
        }
    });

    client.on('chat:public', function(chat) {
        for (var i = 0, len = conn.battle_conns.length; i < len; i++) {
            if (conn.battle_conns[i].room == chat.room) {
                conn.battle_conns[i].chat = chat.data;
                break;
            }
        }
    });

    client.on('message', function(message) {
        if (message.type.toString().search('token:request') != -1) {
            for (var i = 0, len = conn.battle_conns.length; i < len; i++) {
                if (conn.battle_conns[i].room == message.room) {
                    conn.battle_conns[i].myteam = message.data;
                    break;
                }
            }
        }

        // TODO condense these?
        if (action_list.includes(message.type)) {
            var need_pending = 1;
            for (var i = 0, len = conn.battle_conns.length; i < len; i++) {
                if (conn.battle_conns[i].room == message.room) {
                    if (message.type.toString().search('token:turn') != -1) {
                        conn.battle_conns[i].turn = Number(message.data);
                        conn.battle_conns[i].actions.push([]);
                    } else {
                        var turn = conn.battle_conns[i].turn;
                        var type = message.type.toString().split(':')[2].replace(')', '');
                        if (!('data' in message)) {
                            message.data = {}
                        }
                        message.data['msg_type'] = type;
                        conn.battle_conns[i].actions[turn].push(message.data);
                    }

                    need_pending = 0;
                    break;
                }
            }

            if (need_pending) {
                for (var i = 0, len = conn.battles_pending.length; i < len; i++) {
                    if (conn.battles_pending[i].room == message.room) {
                        if (message.type.toString().search('token:turn') != -1) {
                            conn.battles_pending[i].turn = Number(message.data);
                            conn.battles_pending[i].actions.push([]);
                        } else {
                            var turn = conn.battles_pending[i].turn;
                            var type = message.type.toString().split(':')[2].replace(')', '');
                            if (!('data' in message)) {
                                message.data = {}
                            }
                            message.data['msg_type'] = type;
                            conn.battles_pending[i].actions[turn].push(message.data);
                        }

                        break;
                    }
                }
            }
        }

        // console.log(message);
    });

    conn.on('close', function(data) {
        client.send('/logout', 'global');
        console.log(conn.username + ' logged out');

        for (var i = 0, len = login_connections.length; i < len; i++) {
            if (login_connections[i].username == conn.username) {
                login_connections.splice(i, 1);
                break;
            }
        }
    });

    client.on('internal:send', function(message) {
        console.log(message);
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
    send_reply(conn.battles_pending, conn);
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

function battle_start(payload, conn) {
    conn.room = payload.room;
    if (payload.open_wndw) {
        open(base_url + conn.room);
    }

    for (var i = 0, len = login_connections.length; i < len; i++) {
        if (login_connections[i].username == payload.username) {
            conn.parent_conn = login_connections[i];
            conn.parent_conn.battle_conns.push(conn);
            break;
        }
    }

    for (var i = 0, len = conn.parent_conn.battles_pending.length; i < len; i++) {
        if (conn.parent_conn.battles_pending[i].room == conn.room) {
            var pending = conn.parent_conn.battles_pending[i];
            conn['chat'] = pending.chat;
            conn['myteam'] = pending.myteam;
            conn['actions'] = pending.actions;
            conn.turn = pending.turn;
            break;
        }
    }

    send_reply('success', conn);
}


function battle_helper(payload, conn, key) {
    reply = {};
    if (key in conn) {
        reply = conn[key];
    } else {
        for (var i = 0, len = conn.parent_conn.battles_pending.length; i < len; i++) {
            if (conn.parent_conn.battles_pending[i].room == conn.room) {
                reply = conn.parent_conn.battles_pending[i][key];
                break;
            }
        }
    }

    send_reply(reply, conn);
}

function battle_get_myteam(payload, conn) {
    battle_helper(payload, conn, 'myteam')
}

function battle_get_actions(payload, conn) {
    battle_helper(payload, conn, 'actions')
}

function battle_get_chat(payload, conn) {
    battle_helper(payload, conn, 'chat')
}

function battle_do_command(payload, conn) {
    client = conn.parent_conn.pokeClient;
    client.send(payload.command_msg, payload.room);
    send_reply('sent', conn);
}

function battle_wait_next_turn(payload, conn) {
    var client = conn.parent_conn.client;
    var timeout_event_flag = true;

    var timeout_helper = function() {
        if (!timeout_event_flag) {
            return;
        }

        timeout_event_flag = false;

        send_reply('timeout', conn);
    };

    var wait_helper = function(message) {
        if (!timeout_event_flag) {
            return;
        }
        if (action_list.includes(message.type)) {
            if (conn.room == message.room) {
                if (message.type.toString().search('token:turn') != -1) {
                    turn = Number(message.data);
                    timeout_event_flag = false;
                    send_reply(turn, conn);
                    return;
                } else if (message.type.toString().search('token:faint') != -1) {
                    timeout_event_flag = false;
                    send_reply('fainted', conn);
                    return;
                } else if (message.type.toString().search('token:win') != -1) {
                    timeout_event_flag = false;
                    send_reply('win', conn);
                    return;
                } else if (message.type.toString().search('token:tie') != -1) {
                    timeout_event_flag = false;
                    send_reply('tie', conn);
                    return;
                } else if (message.type.toString().search('token:teampreview') != -1) {
                    timeout_event_flag = false;
                    send_reply('teampreview', conn);
                    return;
                } else if (message.type.toString().search('token:error') != -1) {
                    for (var i = turn_length - 1; i >= 0; i--) {
                        if (turn[i].msg_type == 'error' && !('seen' in turn[i])) {
                            turn[i]['seen'] = true;
                            break;
                        }
                    }
                    timeout_event_flag = false;
                    send_reply('error', conn);
                    return;
                }
            }
        }

        client.once('message', wait_helper);
    };

    if (payload.turn == conn.turn) {
        if ('actions' in conn) {
            var actions_length = conn.actions.length;
            var turn = conn.actions[actions_length - 1];
            var turn_length = turn.length;

            for (var i = turn_length - 1; i >= 0; i--) {
                if (turn[i].msg_type == 'error' && !('seen' in turn[i])) {
                    turn[i]['seen'] = true;
                    send_reply('error', conn);
                    return;
                } else if (turn[i].msg_type == 'teampreview') {
                    send_reply('teampreview', conn);
                    return;
                }
            }
        }

        if (payload.timeout > 0) {
            setTimeout(timeout_helper, payload.timeout);
        }
        client.once('message', wait_helper);

        return;
    } else if (payload.turn > conn.turn) {
        send_reply('failed', conn);
        return;
    } else if (payload.turn < conn.turn) {
        send_reply(conn.turn, conn);
    }

    send_reply('undefined', conn);
}

function battle_send_teampreview(payload, conn) {
    var client = conn.parent_conn.client;

    var turn_helper = function(message) {
        if (conn.room == message.room) {
            if (message.type.toString().search('token:turn') != -1) {
                send_reply('success', conn);
                return;
            } else if (message.type.toString().search('token:error') != -1) {
                send_reply('failed', conn);
                return;
            }
        }
        client.once('message', turn_helper);
    };

    client.once('message', turn_helper);

    client.send('/team ' + payload.index, payload.room);
}

function battle_dispatch(payload, conn) {
    switch (payload.battle_command) {
        case 'get_myteam':
            battle_get_myteam(payload, conn);
            break;
        case 'get_actions':
            battle_get_actions(payload, conn);
            break;
        case 'get_chat':
            battle_get_chat(payload, conn);
            break;
        case 'do_move':
        case 'do_switch':
        case 'do_command_default':
            battle_do_command(payload, conn);
            break;
        case 'wait_next_turn':
            battle_wait_next_turn(payload, conn);
            break;
        case 'send_teampreview':
            battle_send_teampreview(payload, conn);
            break;
        default:
            console.log('battle_command not handled: ' + payload.battle_command);
            send_reply('error', conn);
            break;
    }
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
        case 'battle_start':
            battle_start(payload, conn);
            break;
        case 'get_battles':
            get_battles(conn);
            break;
        case 'battle_action':
            battle_dispatch(payload, conn);
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

var server = net.createServer();
server.listen(9001, 'localhost', 100);

server.on('connection', function(conn) {
    conn.on('data', function(data) {
        dispatch(data, conn);
    });

    conn.on('error', function(error) {
        console.log(error);
    });

    conn.on('close', function(data) {
    });
});
